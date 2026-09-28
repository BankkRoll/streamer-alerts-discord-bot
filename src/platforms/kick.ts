/**
 * Kick live-status checker.
 *
 * Kick exposes an unauthenticated JSON endpoint at
 * `/api/v2/channels/<slug>`, which makes it the most reliable of the five
 * platforms here — there is no HTML to parse and the live flag is explicit.
 *
 * The complication is Cloudflare. Kick fronts the endpoint with bot
 * mitigation that intermittently answers with an HTML challenge instead of
 * JSON, or with a 403. Both are handled as "could not determine" rather than
 * "offline", because treating a challenge page as an offline signal would
 * silently stop alerts for every tracked Kick streamer at once.
 *
 * @module platforms/kick
 */

import { fetchJson, HttpError } from "./http.js";
import { failed, parseError, ParseFailure, requestError } from "./errors.js";
import { encodeHandle, validateUsername } from "./validation.js";
import {
  asArray,
  count,
  dig,
  flag,
  language,
  prose,
  tags,
  text,
  timestamp,
  url as parseUrl,
} from "./parse.js";
import type { LiveStatus } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/** Public channel endpoint. `v2` carries the livestream object `v1` omits. */
const API_BASE = "https://kick.com/api/v2/channels";

/**
 * WARNING: Kick's Cloudflare rules fingerprint the TLS handshake (JA3), not
 * just the headers. Node's TLS stack produces a fingerprint that some egress
 * IPs — datacenter ranges especially — are blocked on outright, answering every
 * request with `403 {"error":"Request blocked by security policy."}` no matter
 * what headers are sent. No header combination fixes it from `fetch`; it needs
 * either a residential egress IP or a TLS-impersonating client.
 *
 * This is handled rather than worked around: a 403 becomes a descriptive error
 * on the LiveStatus, so the deploy sees "Kick refused the request" instead of
 * every Kick streamer silently appearing offline forever.
 */

/**
 * Check whether a Kick channel is currently broadcasting.
 *
 * Never throws: a transport failure, a bot challenge, or an unrecognised
 * payload all return `isLive: false` with a populated `error`, while a genuine
 * offline channel returns `isLive: false` with no `error` and whatever profile
 * data the response carried.
 *
 * @param username - Kick channel slug, as entered by the user.
 * @param signal - Optional cancellation signal, propagated to the request.
 * @returns The channel's live status.
 *
 * @example
 * ```ts
 * const status = await checkKickLive("xqc", AbortSignal.timeout(15_000));
 * if (status.error) logger.warn(status.error);
 * else if (status.isLive) announce(status);
 * ```
 */
export async function checkKickLive(
  username: string,
  signal?: AbortSignal,
): Promise<LiveStatus> {
  const validation = validateUsername("kick", username);
  if (!validation.ok) {
    return failed(
      { platform: "kick", username, url: `https://kick.com/` },
      validation.reason,
    );
  }

  const slug = validation.normalised;
  const channelUrl = `https://kick.com/${encodeHandle(slug)}`;
  const base = { platform: "kick", username: slug, url: channelUrl } as const;

  let payload: unknown;
  try {
    const response = await fetchJson<unknown>(
      `${API_BASE}/${encodeHandle(slug)}`,
      { signal },
    );
    payload = response.data;
  } catch (error) {
    // A 404 is a real answer — the slug does not exist — and is worth saying
    // plainly rather than reporting as a transport failure the user might
    // expect to resolve on its own.
    if (error instanceof HttpError && error.status === 404) {
      return failed(base, `No Kick channel named "${slug}" exists.`);
    }
    logger.debug(`[kick] request failed for ${slug}: ${String(error)}`);
    return failed(base, requestError("kick", error));
  }

  const channel = dig(payload, "user") !== undefined ? payload : undefined;
  if (!channel) {
    // The endpoint answered with JSON that has no `user` object at all, which
    // means the response shape changed rather than that the channel is idle.
    return failed(
      base,
      parseError("kick", ParseFailure.SHAPE_CHANGED, "missing user object"),
    );
  }

  const profile = {
    displayName: text(dig(channel, "user", "username"), 64),
    followers: count(dig(channel, "followers_count")),
    profileImage: parseUrl(dig(channel, "user", "profile_pic")),
    verified: flag(dig(channel, "verified")) ?? false,
    bio: prose(dig(channel, "user", "bio")),
  };

  // A banned channel still returns a payload, with `livestream: null`. Saying
  // so is more useful than an unexplained permanent offline.
  if (flag(dig(channel, "is_banned")) === true) {
    return { ...base, ...profile, isLive: false, error: `This Kick channel is banned.` };
  }

  const livestream = dig(channel, "livestream");

  // `livestream: null` is Kick's explicit offline signal, and is the one case
  // where a missing object genuinely means offline rather than a parse failure.
  if (livestream === null || livestream === undefined) {
    return { ...base, ...profile, isLive: false };
  }

  const isLive = flag(dig(livestream, "is_live"));
  if (isLive === undefined) {
    return failed(
      base,
      parseError(
        "kick",
        ParseFailure.SHAPE_CHANGED,
        "livestream.is_live missing",
      ),
    );
  }

  if (!isLive) {
    return { ...base, ...profile, isLive: false };
  }

  // `recent_categories[0].banner.url` is on files.kick.com and loads publicly,
  // whereas the livestream's own category banner is frequently absent.
  const categoryIcon = parseUrl(
    dig(asArray(dig(channel, "recent_categories"))?.[0], "banner", "url"),
  );

  return {
    ...base,
    ...profile,
    isLive: true,
    title: prose(dig(livestream, "session_title"), 256),
    viewers: count(dig(livestream, "viewer_count")),
    // NOTE: stream.kick.com thumbnails require a signed request, so the
    // livestream thumbnail is unusable here and the category banner stands in.
    thumbnail: parseUrl(dig(livestream, "thumbnail", "url")),
    startedAt: timestamp(dig(livestream, "start_time")),
    category: text(
      dig(asArray(dig(livestream, "categories"))?.[0], "name"),
      64,
    ),
    categoryIcon,
    tags: tags(dig(livestream, "tags")),
    language: language(dig(livestream, "language")),
    isMature: flag(dig(livestream, "is_mature")),
  };
}
