/**
 * Turning failures into `LiveStatus.error` strings.
 *
 * A checker never throws, so every failure becomes a string a human reads in
 * Discord. Two distinctions matter and the original checkers made neither:
 *
 * - **Offline vs. undetermined.** `{ isLive: false }` with no error means the
 *   platform was reached and said the channel is not broadcasting. A check
 *   that could not reach that conclusion must set `error`, or a scraper broken
 *   by a markup change silently reports every tracked streamer as offline and
 *   the alerts just stop.
 * - **Transient vs. structural.** A 503 resolves itself; a parser that can no
 *   longer find the live flag needs a code change. The wording says which, so
 *   whoever reads the log knows whether to wait or to open the file.
 *
 * @module platforms/errors
 */

import {
  HttpError,
  NetworkError,
  ResponseError,
  TimeoutError,
} from "./http.js";
import type { LiveStatus, Platform } from "../types/streamer.js";

/**
 * Reasons a check can fail to determine live status.
 *
 * Used to keep the wording of structural failures consistent across the five
 * checkers rather than having each invent its own phrasing.
 */
export const ParseFailure = {
  /** The response arrived but contained none of the expected markers. */
  MARKUP_CHANGED: "markup-changed",
  /** The embedded JSON blob was found but did not parse. */
  MALFORMED_JSON: "malformed-json",
  /** The JSON parsed but the expected path through it is gone. */
  SHAPE_CHANGED: "shape-changed",
  /** The platform served a bot challenge or consent wall instead of content. */
  BLOCKED: "blocked",
} as const;

/** One of the {@link ParseFailure} reasons. */
export type ParseFailureReason =
  (typeof ParseFailure)[keyof typeof ParseFailure];

/**
 * Compose the error text for a scraper that could not determine live status.
 *
 * Always phrased as "could not determine", never as "offline", so a consumer
 * reading the message is not misled about what the bot actually observed.
 *
 * @param platform - Platform being checked.
 * @param reason - Which structural failure occurred.
 * @param detail - Optional specifics, such as the marker that went missing.
 * @returns A message suitable for {@link LiveStatus.error}.
 *
 * @example
 * ```ts
 * parseError("youtube", ParseFailure.MARKUP_CHANGED, "ytInitialData");
 * // "Could not determine YouTube live status: page markup has changed
 * //  (ytInitialData). The parser needs updating."
 * ```
 */
export function parseError(
  platform: Platform,
  reason: ParseFailureReason,
  detail?: string,
): string {
  const name = PLATFORM_LABELS[platform];
  const suffix = detail ? ` (${detail})` : "";

  switch (reason) {
    case ParseFailure.MARKUP_CHANGED:
      return (
        `Could not determine ${name} live status: page markup has changed` +
        `${suffix}. The parser needs updating.`
      );
    case ParseFailure.MALFORMED_JSON:
      return (
        `Could not determine ${name} live status: embedded data was not valid ` +
        `JSON${suffix}. The parser needs updating.`
      );
    case ParseFailure.SHAPE_CHANGED:
      return (
        `Could not determine ${name} live status: embedded data no longer ` +
        `contains the expected fields${suffix}. The parser needs updating.`
      );
    case ParseFailure.BLOCKED:
      return (
        `Could not determine ${name} live status: the platform served a ` +
        `bot-protection or consent page${suffix} instead of channel content.`
      );
    default:
      return `Could not determine ${name} live status${suffix}.`;
  }
}

/**
 * Describe a transport or HTTP failure in terms a user can act on.
 *
 * @param platform - Platform being checked.
 * @param error - The thrown value from the HTTP layer.
 * @returns A message suitable for {@link LiveStatus.error}.
 *
 * @example
 * ```ts
 * requestError("kick", new HttpError(429, "Too Many Requests", url));
 * // "Kick is rate limiting requests (HTTP 429). Status could not be checked."
 * ```
 */
export function requestError(platform: Platform, error: unknown): string {
  const name = PLATFORM_LABELS[platform];

  if (error instanceof HttpError) {
    if (error.status === 429) {
      return (
        `${name} is rate limiting requests (HTTP 429). ` +
        `Status could not be checked.`
      );
    }
    if (error.status === 403) {
      return (
        `${name} refused the request (HTTP 403), usually bot protection. ` +
        `Status could not be checked.`
      );
    }
    if (error.status >= 500) {
      return `${name} is having server problems (HTTP ${error.status}). Status could not be checked.`;
    }
    return `${name} returned HTTP ${error.status}. Status could not be checked.`;
  }

  if (error instanceof TimeoutError) {
    return `${name} did not respond within ${error.timeoutMs}ms. Status could not be checked.`;
  }

  if (error instanceof ResponseError) {
    return `Could not read the ${name} response: ${error.message}`;
  }

  if (error instanceof NetworkError) {
    return `Could not reach ${name}: ${error.message}`;
  }

  // A caller-initiated abort is a shutdown or a cancelled command, not a fault
  // of the platform, so it should not read like one in the log.
  if (error instanceof Error && error.name === "AbortError") {
    return `The ${name} check was cancelled before it completed.`;
  }

  if (error instanceof Error) {
    return `Unexpected error checking ${name}: ${error.message}`;
  }

  return `Unexpected error checking ${name}: ${String(error)}`;
}

/** Human-readable platform names used in error messages. */
const PLATFORM_LABELS: Record<Platform, string> = {
  kick: "Kick",
  twitch: "Twitch",
  youtube: "YouTube",
  rumble: "Rumble",
  tiktok: "TikTok",
};

/**
 * Build the failure `LiveStatus` a checker returns when it cannot answer.
 *
 * @param base - The offline-shaped result carrying platform, username, and URL.
 * @param error - Message explaining why the check could not conclude.
 * @returns A `LiveStatus` with `isLive: false` and `error` set.
 */
export function failed(
  base: Pick<LiveStatus, "platform" | "username" | "url">,
  error: string,
): LiveStatus {
  return { ...base, isLive: false, error };
}
