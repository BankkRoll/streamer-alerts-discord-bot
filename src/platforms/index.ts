/**
 * Platform checker registry.
 *
 * The single place that maps a {@link Platform} to the function that checks it.
 * Callers — the poller, the `/check` command — resolve a checker here rather
 * than importing the five modules directly, so adding a platform touches one
 * file.
 *
 * @module platforms
 */

import { checkKickLive } from "./kick.js";
import { checkRumbleLive } from "./rumble.js";
import { checkTikTokLive } from "./tiktok.js";
import { checkTwitchLive } from "./twitch.js";
import { checkYouTubeLive } from "./youtube.js";
import type { Platform, PlatformChecker } from "../types/streamer.js";

/**
 * Every platform's checker, keyed by platform id.
 *
 * `satisfies Record<Platform, PlatformChecker>` rather than a type annotation:
 * it enforces exhaustiveness — adding an id to the {@link Platform} union
 * breaks this build until a checker exists — while preserving the literal key
 * types, so {@link getChecker} needs no index-signature widening.
 *
 * @example
 * ```ts
 * const status = await platformCheckers.twitch("pokimane");
 * ```
 */
export const platformCheckers = {
  kick: checkKickLive,
  twitch: checkTwitchLive,
  youtube: checkYouTubeLive,
  rumble: checkRumbleLive,
  tiktok: checkTikTokLive,
} as const satisfies Record<Platform, PlatformChecker>;

/**
 * Resolve the checker for a platform.
 *
 * Total over {@link Platform}: the registry above is exhaustive, so this never
 * returns `undefined` and callers need no fallback.
 *
 * @param platform - Platform to check.
 * @returns The checker for that platform.
 *
 * @example
 * ```ts
 * const check = getChecker(streamer.platform);
 * const status = await check(streamer.username, controller.signal);
 * ```
 */
export function getChecker(platform: Platform): PlatformChecker {
  return platformCheckers[platform];
}

export { checkKickLive } from "./kick.js";
export { checkRumbleLive } from "./rumble.js";
export { checkTikTokLive } from "./tiktok.js";
export { checkTwitchLive } from "./twitch.js";
export { checkYouTubeLive } from "./youtube.js";

export {
  encodeHandle,
  validateUsername,
  type InvalidUsername,
  type UsernameValidation,
  type ValidUsername,
} from "./validation.js";

export {
  fetchJson,
  fetchText,
  HttpError,
  NetworkError,
  PlatformHttpError,
  ResponseError,
  TimeoutError,
  type HttpResponse,
  type RequestOptions,
} from "./http.js";

export type {
  LiveStatus,
  Platform,
  PlatformChecker,
  PlatformConfig,
} from "../types/streamer.js";
