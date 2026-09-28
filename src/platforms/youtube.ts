/**
 * YouTube live-status checker.
 *
 * Strategy: request `https://www.youtube.com/@<handle>/live`. When the channel
 * is broadcasting, YouTube serves the watch page for the active stream; when
 * it is not, it serves the channel page or a "no live stream" shell. The
 * difference is read out of the `ytInitialPlayerResponse` blob embedded in the
 * HTML.
 *
 * This is the most fragile checker in the bot, for three reasons:
 *
 * - The payload is a megabyte of minified JSON whose shape YouTube reorganises
 *   regularly. Every traversal is guarded and a missing path is reported as a
 *   parse failure, never as "offline".
 * - YouTube serves a consent interstitial to requests from some regions, which
 *   contains no player data at all. That is detected explicitly, because it
 *   otherwise looks identical to a channel that is simply not live.
 * - Upcoming premieres and scheduled streams carry `isLive: false` alongside
 *   `isLiveContent: true`; only an actively broadcasting stream should alert.
 *
 * @module platforms/youtube
 */

import { fetchText, HttpError } from "./http.js";
import { failed, parseError, ParseFailure, requestError } from "./errors.js";
import { encodeHandle, validateUsername } from "./validation.js";
import {
  abbreviatedCount,
  asArray,
  asRecord,
  count,
  decodeEntities,
  dig,
  extractJsonAfter,
  flag,
  language,
  parseJsonSafe,
  prose,
  text,
  timestamp,
  url as parseUrl,
} from "./parse.js";
import type { LiveStatus } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/**
 * Marker preceding the player payload, which carries the live flags.
 *
 * The trailing `= ` matters. The bare identifier `ytInitialPlayerResponse`
 * also appears inside YouTube's minified bundle on every page, so matching on
 * the name alone finds a fragment of JavaScript rather than the payload.
 */
const PLAYER_RESPONSE_MARKER = "ytInitialPlayerResponse = ";

/** Marker preceding the page payload, which carries channel metadata. */
const INITIAL_DATA_MARKER = "var ytInitialData = ";

/**
 * Check whether a YouTube channel is currently streaming.
 *
 * Never throws. When the page cannot be parsed the result carries an `error`
 * saying so explicitly, so a YouTube redesign surfaces as a visible failure
 * rather than as every tracked channel appearing to go offline at once.
 *
 * @param username - YouTube handle without the leading `@`.
 * @param signal - Optional cancellation signal, propagated to the request.
 * @returns The channel's live status. When live, `url` points at the watch
 *   page for the active stream rather than at the channel.
 *
 * @example
 * ```ts
 * const status = await checkYouTubeLive("MrBeast");
 * if (status.isLive) console.log(status.url); // https://www.youtube.com/watch?v=...
 * ```
 */
export async function checkYouTubeLive(
  username: string,
  signal?: AbortSignal,
): Promise<LiveStatus> {
  const validation = validateUsername("youtube", username);
  if (!validation.ok) {
    return failed(
      { platform: "youtube", username, url: "https://www.youtube.com/" },
      validation.reason,
    );
  }

  const handle = validation.normalised;
  const channelUrl = `https://www.youtube.com/@${encodeHandle(handle)}`;
  const base = {
    platform: "youtube",
    username: handle,
    url: channelUrl,
  } as const;

  let html: string;
  try {
    const response = await fetchText(`${channelUrl}/live`, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        // Bypasses the EU consent interstitial, which otherwise replaces the
        // page with a cookie wall containing no player data.
        Cookie: "CONSENT=YES+cb; SOCS=CAI",
      },
      signal,
    });
    html = response.data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return failed(base, `No YouTube channel with the handle "@${handle}" exists.`);
    }
    logger.debug(`[youtube] request failed for @${handle}: ${String(error)}`);
    return failed(base, requestError("youtube", error));
  }

  if (isConsentWall(html)) {
    return failed(base, parseError("youtube", ParseFailure.BLOCKED, "consent wall"));
  }

  const player = asRecord(
    parseJsonSafe(extractJsonAfter(html, PLAYER_RESPONSE_MARKER)),
  );
  const initial = asRecord(
    parseJsonSafe(extractJsonAfter(html, INITIAL_DATA_MARKER)),
  );

  // Neither blob present means the page is not the one this parser was written
  // against — a redesign, a redirect to a login, or a soft block.
  if (!player && !initial) {
    return failed(
      base,
      parseError(
        "youtube",
        ParseFailure.MARKUP_CHANGED,
        "neither ytInitialPlayerResponse nor ytInitialData found",
      ),
    );
  }

  const profile = extractProfile(initial);

  // A channel with nothing live serves its channel page, which carries
  // ytInitialData but no player payload at all. That absence is YouTube's
  // offline signal on this route, so it is only a parse failure when the page
  // *is* a watch page — proven by the watch-page renderer in ytInitialData.
  if (!player) {
    return isWatchPage(initial)
      ? {
          ...base,
          ...profile,
          isLive: false,
          error: parseError(
            "youtube",
            ParseFailure.SHAPE_CHANGED,
            "watch page without ytInitialPlayerResponse",
          ),
        }
      : { ...base, ...profile, isLive: false };
  }

  const playability = text(dig(player, "playabilityStatus", "status"), 32);

  // ERROR means the video does not exist, which on the /live route is how
  // YouTube says "this channel has no live stream right now".
  if (playability === "ERROR") {
    return { ...base, ...profile, isLive: false };
  }

  const details = asRecord(player.videoDetails);

  // A channel with no current or recent stream serves the channel page, which
  // has no videoDetails. That is a legitimate offline answer.
  if (!details) {
    return { ...base, ...profile, isLive: false };
  }

  const isLiveNow = flag(details.isLive) === true;

  // A scheduled premiere sets isLiveContent without isLive; alerting on it
  // would announce a stream that has not started.
  if (!isLiveNow) {
    return { ...base, ...profile, isLive: false };
  }

  const videoId = text(details.videoId, 32);
  const streamUrl = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : channelUrl;

  return {
    ...base,
    ...profile,
    isLive: true,
    url: streamUrl,
    username: text(details.author, 64) ?? profile.displayName ?? handle,
    displayName: text(details.author, 64) ?? profile.displayName,
    title: decodeEntities(details.title)?.slice(0, 256),
    // `viewCount` on a live stream is the concurrent viewer count, not the
    // lifetime total it represents on a VOD.
    viewers:
      count(dig(player, "videoDetails", "viewCount")) ??
      count(
        dig(
          player,
          "microformat",
          "playerMicroformatRenderer",
          "liveBroadcastDetails",
          "viewCount",
        ),
      ),
    thumbnail: bestThumbnail(dig(details, "thumbnail", "thumbnails")) ?? (videoId
      ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault_live.jpg`
      : undefined),
    startedAt: timestamp(
      dig(
        player,
        "microformat",
        "playerMicroformatRenderer",
        "liveBroadcastDetails",
        "startTimestamp",
      ),
    ),
    category: text(
      dig(player, "microformat", "playerMicroformatRenderer", "category"),
      64,
    ),
    tags: keywordTags(details.keywords),
    language: language(
      dig(player, "microformat", "playerMicroformatRenderer", "language"),
    ),
    isMature:
      flag(dig(player, "microformat", "playerMicroformatRenderer", "isFamilySafe")) ===
      false
        ? true
        : undefined,
  };
}

/** Channel-level fields read from the page payload. */
interface YouTubeProfile {
  displayName?: string;
  followers?: number;
  profileImage?: string;
  bio?: string;
  verified?: boolean;
}

/**
 * Pull channel metadata out of `ytInitialData`.
 *
 * YouTube places the owner block in a different renderer depending on whether
 * the request resolved to a watch page or a channel page, so both locations
 * are tried. Every field is optional by design — losing a profile image must
 * not turn into a failed check.
 *
 * @param initial - The parsed `ytInitialData` payload, when present.
 * @returns Whatever channel metadata could be recovered.
 */
function extractProfile(
  initial: Record<string, unknown> | undefined,
): YouTubeProfile {
  if (!initial) return {};

  // Watch-page shape: the owner sits inside the secondary info renderer.
  const owner = findOwnerRenderer(initial);
  if (owner) {
    return {
      displayName: text(dig(owner, "title", "runs", "0", "text"), 64),
      followers: abbreviatedCount(dig(owner, "subscriberCountText", "simpleText")),
      profileImage: bestThumbnail(dig(owner, "thumbnail", "thumbnails")),
      verified: hasVerifiedBadge(owner),
    };
  }

  // Channel-page shape: metadata lives in a top-level renderer instead.
  const metadata = asRecord(dig(initial, "metadata", "channelMetadataRenderer"));
  if (metadata) {
    return {
      displayName: text(metadata.title, 64),
      profileImage: bestThumbnail(dig(metadata, "avatar", "thumbnails")),
      bio: prose(metadata.description),
    };
  }

  return {};
}

/**
 * Locate the `videoOwnerRenderer` in the watch-page content list.
 *
 * The index of the secondary info renderer is not stable, so the list is
 * scanned rather than indexed.
 *
 * @param initial - The parsed `ytInitialData` payload.
 * @returns The owner renderer, or `undefined`.
 */
function findOwnerRenderer(
  initial: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const contents = asArray(
    dig(
      initial,
      "contents",
      "twoColumnWatchNextResults",
      "results",
      "results",
      "contents",
    ),
  );
  if (!contents) return undefined;

  for (const item of contents) {
    const owner = asRecord(
      dig(item, "videoSecondaryInfoRenderer", "owner", "videoOwnerRenderer"),
    );
    if (owner) return owner;
  }

  return undefined;
}

/**
 * Detect the channel verification badge.
 *
 * @param owner - The owner renderer.
 * @returns `true` when a verified badge is present, otherwise `undefined`.
 */
function hasVerifiedBadge(
  owner: Record<string, unknown>,
): boolean | undefined {
  const badges = asArray(owner.badges);
  if (!badges) return undefined;

  const verified = badges.some((badge) => {
    const style = text(dig(badge, "metadataBadgeRenderer", "style"), 64);
    return style === "BADGE_STYLE_TYPE_VERIFIED" ||
      style === "BADGE_STYLE_TYPE_VERIFIED_ARTIST";
  });

  return verified ? true : undefined;
}

/**
 * Pick the highest-resolution entry from a YouTube thumbnail array.
 *
 * The array is documented as ascending by size but is not reliably sorted, so
 * the widest entry is selected explicitly.
 *
 * @param value - A `thumbnails` array from the payload.
 * @returns The best usable URL, or `undefined`.
 */
function bestThumbnail(value: unknown): string | undefined {
  const entries = asArray(value);
  if (!entries || entries.length === 0) return undefined;

  let best: string | undefined;
  let bestWidth = -1;

  for (const entry of entries) {
    const candidate = parseUrl(dig(entry, "url"));
    if (!candidate) continue;

    const width = count(dig(entry, "width")) ?? 0;
    if (width > bestWidth) {
      bestWidth = width;
      best = candidate;
    }
  }

  return best;
}

/**
 * Convert the `keywords` array into a bounded tag list.
 *
 * @param value - The `keywords` field from `videoDetails`.
 * @returns Up to ten tags, or `undefined`.
 */
function keywordTags(value: unknown): string[] | undefined {
  const entries = asArray(value);
  if (!entries) return undefined;

  const result = entries
    .map((entry) => text(entry, 48))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, 10);

  return result.length > 0 ? result : undefined;
}

/**
 * Decide whether the response is a watch page rather than a channel page.
 *
 * `/@handle/live` resolves to a watch page only when a stream is playing; when
 * nothing is live it stays on the channel. The distinction decides whether a
 * missing player payload is "offline" or "the parser broke", so it is read
 * from the renderer YouTube uses for the two-column watch layout rather than
 * inferred from the URL, which does not change on this route.
 *
 * @param initial - The parsed `ytInitialData` payload, when present.
 * @returns `true` when the page is a watch page.
 */
function isWatchPage(initial: Record<string, unknown> | undefined): boolean {
  if (!initial) return false;
  return (
    asRecord(dig(initial, "contents", "twoColumnWatchNextResults")) !== undefined
  );
}

/**
 * Recognise YouTube's cookie-consent interstitial.
 *
 * The page is a full HTML document with no player payload, so without this
 * check it would be indistinguishable from a channel that is simply offline.
 *
 * @param html - The response body.
 * @returns `true` when the response is a consent wall.
 */
function isConsentWall(html: string): boolean {
  return (
    html.includes("consent.youtube.com") ||
    html.includes("action=\"https://consent.youtube.com/save\"")
  );
}
