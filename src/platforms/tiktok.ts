/**
 * TikTok live-status checker.
 *
 * Scrapes `https://www.tiktok.com/@<user>/live` and reads the hydration blob
 * embedded in the page.
 *
 * TikTok has migrated its hydration payload twice. Older pages carry
 * `SIGI_STATE`; current pages carry `__UNIVERSAL_DATA_FOR_REHYDRATION__` with a
 * different nesting. Both are supported, newest first, because TikTok serves
 * them inconsistently depending on edge node and user agent — a checker that
 * only understood one would report intermittent false offlines.
 *
 * TikTok is also the most aggressively bot-mitigated of the five. A challenge
 * page or a captcha shell is detected explicitly and reported as undetermined.
 *
 * @module platforms/tiktok
 */

import { fetchText, HttpError } from "./http.js";
import { failed, parseError, ParseFailure, requestError } from "./errors.js";
import { encodeHandle, validateUsername } from "./validation.js";
import {
  asRecord,
  count,
  decodeEntities,
  dig,
  extractJsonAfter,
  flag,
  parseJsonSafe,
  prose,
  text,
  timestamp,
  url as parseUrl,
} from "./parse.js";
import type { LiveStatus } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/**
 * TikTok's live-room status code for an active broadcast.
 *
 * 2 is live; 4 is ended. Anything else is treated as not live.
 */
const LIVE_ROOM_STATUS = 2;

/** Markers indicating a bot challenge rather than channel content. */
const CHALLENGE_MARKERS = [
  "captcha-verify-page",
  "verify-bar-close",
  "/aweme/v1/verify",
  "Please wait while we verify",
] as const;

/**
 * Check whether a TikTok user is currently live.
 *
 * Never throws. A bot challenge, a missing hydration blob, or an unrecognised
 * payload shape sets `error`; only an explicit non-live room status produces a
 * clean `isLive: false`.
 *
 * @param username - TikTok username without the leading `@`.
 * @param signal - Optional cancellation signal, propagated to the request.
 * @returns The user's live status.
 *
 * @example
 * ```ts
 * const status = await checkTikTokLive("someuser");
 * ```
 */
export async function checkTikTokLive(
  username: string,
  signal?: AbortSignal,
): Promise<LiveStatus> {
  const validation = validateUsername("tiktok", username);
  if (!validation.ok) {
    return failed(
      { platform: "tiktok", username, url: "https://www.tiktok.com/" },
      validation.reason,
    );
  }

  const handle = validation.normalised;
  const liveUrl = `https://www.tiktok.com/@${encodeHandle(handle)}/live`;
  const base = { platform: "tiktok", username: handle, url: liveUrl } as const;

  let html: string;
  try {
    const response = await fetchText(liveUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://www.tiktok.com/",
      },
      signal,
    });
    html = response.data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return failed(base, `No TikTok account named "@${handle}" exists.`);
    }
    logger.debug(`[tiktok] request failed for @${handle}: ${String(error)}`);
    return failed(base, requestError("tiktok", error));
  }

  if (CHALLENGE_MARKERS.some((marker) => html.includes(marker))) {
    return failed(
      base,
      parseError("tiktok", ParseFailure.BLOCKED, "captcha challenge"),
    );
  }

  const room = extractLiveRoom(html);
  if (!room) {
    return failed(
      base,
      parseError(
        "tiktok",
        ParseFailure.MARKUP_CHANGED,
        "no SIGI_STATE or __UNIVERSAL_DATA_FOR_REHYDRATION__ live-room payload",
      ),
    );
  }

  const user = asRecord(room.user);
  const stats = asRecord(room.stats);
  const liveRoom = asRecord(room.liveRoom);

  const profile = {
    displayName: decodeEntities(dig(user, "nickname"))?.slice(0, 64),
    followers: count(dig(stats, "followerCount")),
    profileImage:
      parseUrl(dig(user, "avatarLarger")) ??
      parseUrl(dig(user, "avatarMedium")) ??
      parseUrl(dig(user, "avatarThumb")),
    verified: flag(dig(user, "verified")) ?? false,
    bio: prose(dig(user, "signature")),
  };

  // The status appears on the room object on newer payloads and alongside it
  // on older ones; either is authoritative.
  const status =
    count(dig(liveRoom, "status")) ?? count(dig(room, "liveRoomStatus"));

  if (status === undefined) {
    // Profile data parsed but the live flag did not, so the room shape changed.
    // Reporting offline here would be a guess.
    return {
      ...base,
      ...profile,
      isLive: false,
      error: parseError(
        "tiktok",
        ParseFailure.SHAPE_CHANGED,
        "live room status missing",
      ),
    };
  }

  if (status !== LIVE_ROOM_STATUS) {
    return { ...base, ...profile, isLive: false };
  }

  return {
    ...base,
    ...profile,
    isLive: true,
    username: text(dig(user, "uniqueId"), 32) ?? handle,
    title: decodeEntities(dig(liveRoom, "title"))?.slice(0, 256),
    viewers: count(dig(liveRoom, "liveRoomStats", "userCount")),
    // squareCoverImg renders better in a Discord container than coverUrl's
    // portrait crop, so it is preferred when present.
    thumbnail:
      parseUrl(dig(liveRoom, "squareCoverImg")) ??
      parseUrl(dig(liveRoom, "coverUrl")),
    // TikTok sends epoch seconds here, which `timestamp` detects by magnitude.
    startedAt: timestamp(dig(liveRoom, "startTime")),
  };
}

/**
 * Locate the live-room object across TikTok's two hydration formats.
 *
 * Tries the current `__UNIVERSAL_DATA_FOR_REHYDRATION__` layout first, then
 * falls back to the legacy `SIGI_STATE` script. Returns `undefined` when
 * neither is present, which the caller reports as a markup change.
 *
 * @param html - The response body.
 * @returns The `liveRoomUserInfo`-shaped object, or `undefined`.
 */
function extractLiveRoom(html: string): Record<string, unknown> | undefined {
  const universal = asRecord(
    parseJsonSafe(
      extractJsonAfter(
        html,
        'id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">',
      ),
    ),
  );
  if (universal) {
    const scope = dig(universal, "__DEFAULT_SCOPE__");
    const fromUniversal = asRecord(
      dig(scope, "webapp.live-detail", "liveRoomUserInfo"),
    );
    if (fromUniversal) return fromUniversal;
  }

  const sigi = asRecord(
    parseJsonSafe(extractJsonAfter(html, 'id="SIGI_STATE" type="application/json">')),
  );
  if (sigi) {
    const fromSigi = asRecord(dig(sigi, "LiveRoom", "liveRoomUserInfo"));
    if (fromSigi) {
      // The legacy payload keeps liveRoomStatus one level up, so it is copied
      // down to give the caller a single object to read.
      const status = dig(sigi, "LiveRoom", "liveRoomStatus");
      return status === undefined
        ? fromSigi
        : { ...fromSigi, liveRoomStatus: status };
    }
  }

  return undefined;
}
