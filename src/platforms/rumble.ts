/**
 * Rumble live-status checker.
 *
 * Rumble has no public API, so this scrapes the channel page at
 * `https://rumble.com/c/<slug>`. The page is server-rendered HTML with stable
 * BEM-style class names, which makes it more tractable than YouTube's embedded
 * JSON — but it is still markup, and a redesign breaks every selector at once.
 *
 * The live signal is a `live` modifier on a video card. Because a *missing*
 * live marker is also what an offline channel looks like, the parser first
 * establishes that it is actually looking at a channel page (via the header
 * block). If the header is absent, the page is something else entirely and the
 * result is "could not determine" rather than "offline".
 *
 * @module platforms/rumble
 */

import { fetchText, HttpError } from "./http.js";
import { failed, parseError, ParseFailure, requestError } from "./errors.js";
import { encodeHandle, validateUsername } from "./validation.js";
import {
  abbreviatedCount,
  count,
  decodeEntities,
  prose,
  url as parseUrl,
} from "./parse.js";
import type { LiveStatus } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/**
 * Markers proving the response really is a Rumble channel page.
 *
 * Any one is enough. Without this guard a soft-404, an interstitial, or a
 * redesign would parse as a channel with no live stream — a false "offline"
 * that would silently suppress alerts.
 */
const CHANNEL_PAGE_MARKERS = [
  "channel-header--title",
  "channel-header--content",
  "listing-header--content",
  "channel-header--img",
] as const;

/**
 * Class fragments Rumble uses to mark a live video card.
 *
 * Several coexist across the site's template versions, so all are accepted.
 */
const LIVE_MARKERS = [
  "videostream__status--live",
  "thumbnail__thumb--live",
  "video-item--live",
  "videostream__badge--live",
] as const;

/**
 * Check whether a Rumble channel is currently streaming.
 *
 * Never throws. A page that does not look like a Rumble channel produces an
 * `error` explaining that the markup changed, rather than a false offline.
 *
 * @param username - Rumble channel slug, as it appears after `/c/`.
 * @param signal - Optional cancellation signal, propagated to the request.
 * @returns The channel's live status. When live, `url` points at the stream.
 *
 * @example
 * ```ts
 * const status = await checkRumbleLive("Bongino");
 * ```
 */
export async function checkRumbleLive(
  username: string,
  signal?: AbortSignal,
): Promise<LiveStatus> {
  const validation = validateUsername("rumble", username);
  if (!validation.ok) {
    return failed(
      { platform: "rumble", username, url: "https://rumble.com/" },
      validation.reason,
    );
  }

  const slug = validation.normalised;
  const channelUrl = `https://rumble.com/c/${encodeHandle(slug)}`;
  const base = { platform: "rumble", username: slug, url: channelUrl } as const;

  let html: string;
  try {
    const response = await fetchText(channelUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal,
    });
    html = response.data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return failed(base, `No Rumble channel named "${slug}" exists.`);
    }
    logger.debug(`[rumble] request failed for ${slug}: ${String(error)}`);
    return failed(base, requestError("rumble", error));
  }

  if (!CHANNEL_PAGE_MARKERS.some((marker) => html.includes(marker))) {
    return failed(
      base,
      parseError(
        "rumble",
        ParseFailure.MARKUP_CHANGED,
        "channel header not found",
      ),
    );
  }

  const profile = {
    displayName: decodeEntities(
      firstGroup(html, /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/),
    )?.slice(0, 64),
    profileImage: parseUrl(
      firstGroup(
        html,
        /class=["'][^"']*channel-header--img[^"']*["'][^>]*\ssrc=["']([^"']+)["']/,
      ),
    ),
    followers:
      abbreviatedCount(firstGroup(html, /([\d.,]+[KMB]?)\s*[Ff]ollowers/)) ??
      undefined,
    verified: html.includes("channel-header--verified") ? true : undefined,
    bio: prose(
      decodeEntities(
        firstGroup(
          html,
          /class=["'][^"']*channel-header--description[^"']*["'][^>]*>\s*([^<]+)/,
        ),
      ),
    ),
  };

  const isLive = LIVE_MARKERS.some((marker) => html.includes(marker));
  if (!isLive) {
    return { ...base, ...profile, isLive: false };
  }

  // Everything below is best-effort: the channel is known to be live, so a
  // missing title or thumbnail degrades the alert but must not fail the check.
  const streamPath = firstGroup(
    html,
    /class=["'][^"']*videostream__link[^"']*["'][^>]*\shref=["']([^"']+)["']/,
  );
  const streamUrl = streamPath ? absoluteRumbleUrl(streamPath) : undefined;

  return {
    ...base,
    ...profile,
    isLive: true,
    url: streamUrl ?? channelUrl,
    title: decodeEntities(
      firstGroup(
        html,
        /class=["'][^"']*(?:thumbnail__title|videostream__title)[^"']*["'][^>]*>\s*([^<]+?)\s*</,
      ),
    )?.slice(0, 256),
    viewers: count(
      firstGroup(
        html,
        /videostream__views-ppv[^>]*>[\s\S]{0,400}?videostream__number["'][^>]*>\s*([\d,]+)/,
      )?.replace(/,/g, ""),
    ),
    thumbnail: parseUrl(
      firstGroup(
        html,
        /class=["'][^"']*thumbnail__image[^"']*["'][^>]*\ssrc=["']([^"']+)["']/,
      ),
    ),
  };
}

/**
 * Run a regex and return its first capture group.
 *
 * Centralised so no call site has to repeat the optional chaining that keeps a
 * non-match from throwing.
 *
 * @param html - Document to search.
 * @param pattern - Pattern with exactly one capture group.
 * @returns The captured text, or `undefined` when the pattern did not match.
 */
function firstGroup(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html);
  const captured = match?.[1]?.trim();
  // An empty capture means the field was absent, so ?? would be wrong here.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return captured ? captured : undefined;
}

/**
 * Resolve a scraped `href` against Rumble's origin.
 *
 * Rumble emits root-relative hrefs, and the query string carries tracking
 * parameters that are stripped so stored URLs stay stable. `new URL()` does
 * the resolution so a malformed or off-origin href is rejected rather than
 * concatenated into a broken link.
 *
 * @param path - The scraped href value.
 * @returns An absolute rumble.com URL, or `undefined` when it does not resolve.
 */
function absoluteRumbleUrl(path: string): string | undefined {
  try {
    const resolved = new URL(path, "https://rumble.com");
    if (resolved.hostname !== "rumble.com" && !resolved.hostname.endsWith(".rumble.com")) {
      return undefined;
    }
    resolved.search = "";
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return undefined;
  }
}
