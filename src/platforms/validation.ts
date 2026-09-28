/**
 * Username validation and normalisation, per platform.
 *
 * Handles arrive from Discord slash commands, which means they are arbitrary
 * user input that this bot then interpolates into URLs. Two things are at stake:
 *
 * 1. **Safety.** A handle containing `/`, `..`, `?`, `#`, `@`, or a scheme
 *    prefix could redirect a request to an unintended path or host. Validation
 *    rejects those outright rather than relying on escaping alone; checkers
 *    additionally `encodeURIComponent` whatever survives.
 * 2. **Politeness.** A handle that cannot exist on a platform should never
 *    become an HTTP request. Rejecting locally saves the poll budget and keeps
 *    the bot out of rate limiters.
 *
 * Rules are deliberately a little permissive where a platform's documented
 * limits and its actual behaviour disagree — legacy accounts predate most of
 * these constraints, and rejecting a real channel is worse than allowing a
 * request that returns 404.
 *
 * @module platforms/validation
 */

import type { Platform } from "../types/streamer.js";

// -----------------------------------------------------------------------------
// Result type
// -----------------------------------------------------------------------------

/** A handle that passed validation. */
export interface ValidUsername {
  /** Discriminant. */
  ok: true;
  /**
   * Canonical form of the handle: decorations stripped and case normalised
   * where the platform is case-insensitive.
   */
  normalised: string;
}

/** A handle that failed validation. */
export interface InvalidUsername {
  /** Discriminant. */
  ok: false;
  /** User-facing explanation, suitable for display in a Discord reply. */
  reason: string;
}

/** Outcome of {@link validateUsername}. */
export type UsernameValidation = ValidUsername | InvalidUsername;

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

/** Per-platform constraints applied by {@link validateUsername}. */
interface PlatformRule {
  /** Inclusive minimum length, measured after normalisation. */
  minLength: number;
  /** Inclusive maximum length, measured after normalisation. */
  maxLength: number;
  /** Characters a handle may consist of. Anchored; applied after trimming. */
  pattern: RegExp;
  /** Whether the platform treats handles case-insensitively. */
  lowercase: boolean;
  /** Description of {@link PlatformRule.pattern} used in rejection messages. */
  describe: string;
}

/**
 * Validation rules per platform.
 *
 * `satisfies` keeps this exhaustive: adding a platform to the {@link Platform}
 * union fails the build here until a rule exists, so no platform can silently
 * fall back to "anything goes".
 */
const RULES = {
  /**
   * Kick slugs are lowercased and allow underscores; the site enforces 3-25
   * but grandfathered accounts sit slightly outside, so the floor is relaxed.
   */
  kick: {
    minLength: 2,
    maxLength: 25,
    pattern: /^[a-zA-Z0-9_]+$/,
    lowercase: true,
    describe: "letters, numbers, and underscores",
  },

  /**
   * Twitch documents a 4-character minimum, but it postdates a generation of
   * shorter logins that are still live — `xqc` among them. Rejecting a real
   * channel locally is worse than letting the request return 404, so the floor
   * is 3.
   */
  twitch: {
    minLength: 3,
    maxLength: 25,
    pattern: /^[a-zA-Z0-9_]+$/,
    lowercase: true,
    describe: "letters, numbers, and underscores",
  },

  /**
   * YouTube handles (the `@name` form) allow dots and hyphens in addition to
   * alphanumerics and underscores, are 3-30 characters, and are matched
   * case-insensitively even though the display form preserves case.
   */
  youtube: {
    minLength: 3,
    maxLength: 30,
    pattern: /^[a-zA-Z0-9._-]+$/,
    lowercase: false,
    describe: "letters, numbers, dots, hyphens, and underscores",
  },

  /**
   * Rumble channel slugs appear in `/c/<slug>` and preserve case and hyphens.
   * Lowercasing them would break channels whose slug is mixed case.
   */
  rumble: {
    minLength: 2,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9._-]+$/,
    lowercase: false,
    describe: "letters, numbers, dots, hyphens, and underscores",
  },

  /**
   * TikTok usernames are 2-24 characters of alphanumerics, underscores, and
   * dots. A trailing dot is legal on the platform, so it is not special-cased.
   */
  tiktok: {
    minLength: 2,
    maxLength: 24,
    pattern: /^[a-zA-Z0-9._]+$/,
    lowercase: true,
    describe: "letters, numbers, dots, and underscores",
  },
} as const satisfies Record<Platform, PlatformRule>;

/**
 * Characters that must never reach a URL, checked before the per-platform
 * pattern so the rejection message names the real problem.
 *
 * Path separators and query/fragment delimiters could retarget the request;
 * whitespace and control characters usually indicate a paste accident; a colon
 * would allow a scheme prefix.
 */
const UNSAFE_PATTERN = /[\s/\\?#&=%:@'"<>[\]{}|^`~!*()+,;$]/;

/**
 * Decorations users habitually paste around a handle.
 *
 * Stripping them is friendlier than rejecting: someone copying a channel from
 * their browser has no reason to know the bot wants the bare handle.
 */
const LEADING_DECORATIONS = /^[@/]+/;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Validate and normalise a platform handle.
 *
 * Accepts a bare handle or a full channel URL and reduces either to the
 * canonical handle the checkers expect. A rejection carries a reason written
 * for the person who typed it, not for a log.
 *
 * @param platform - Platform the handle belongs to.
 * @param username - Raw user input.
 * @returns `{ ok: true, normalised }` or `{ ok: false, reason }`.
 *
 * @example
 * ```ts
 * validateUsername("twitch", "  @XQC  ");
 * // { ok: true, normalised: "xqc" }
 *
 * validateUsername("twitch", "https://twitch.tv/pokimane");
 * // { ok: true, normalised: "pokimane" }
 *
 * validateUsername("twitch", "ab");
 * // { ok: false, reason: "Twitch usernames must be at least 4 characters." }
 * ```
 */
export function validateUsername(
  platform: Platform,
  username: string,
): UsernameValidation {
  const rule = RULES[platform];

  if (typeof username !== "string") {
    return { ok: false, reason: "A username is required." };
  }

  const fromUrl = extractHandleFromUrl(username.trim());
  const candidate = fromUrl.replace(LEADING_DECORATIONS, "").trim();

  if (!candidate) {
    return { ok: false, reason: "A username is required." };
  }

  // Length is checked before the character test so an obviously truncated or
  // pasted-paragraph input gets the clearer message.
  if (candidate.length < rule.minLength) {
    return {
      ok: false,
      reason: `${label(platform)} usernames must be at least ${rule.minLength} characters.`,
    };
  }
  if (candidate.length > rule.maxLength) {
    return {
      ok: false,
      reason: `${label(platform)} usernames must be at most ${rule.maxLength} characters.`,
    };
  }

  if (UNSAFE_PATTERN.test(candidate)) {
    return {
      ok: false,
      reason:
        "Usernames cannot contain spaces, slashes, or punctuation. " +
        "Enter just the handle, for example `ninja`.",
    };
  }

  if (!rule.pattern.test(candidate)) {
    return {
      ok: false,
      reason: `${label(platform)} usernames may only contain ${rule.describe}.`,
    };
  }

  return {
    ok: true,
    normalised: rule.lowercase ? candidate.toLowerCase() : candidate,
  };
}

/**
 * Percent-encode a handle for safe interpolation into a URL path.
 *
 * Applied by every checker even though {@link validateUsername} has already
 * rejected the dangerous character classes — defence in depth costs nothing
 * here, and it keeps the checkers safe if they are ever called directly.
 *
 * @param username - A handle that has passed {@link validateUsername}.
 * @returns The percent-encoded handle.
 *
 * @example
 * ```ts
 * `https://kick.com/${encodeHandle("some_user")}`;
 * ```
 */
export function encodeHandle(username: string): string {
  return encodeURIComponent(username);
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/**
 * Reduce a pasted channel URL to its handle.
 *
 * Users paste links constantly, so this recognises the shapes the supported
 * platforms actually produce (`/c/<slug>`, `/@<handle>`, `/<login>`) and takes
 * the last meaningful path segment. Input that is not a URL passes through
 * untouched.
 *
 * @param input - Trimmed user input.
 * @returns The extracted handle, or `input` when it is not a URL.
 */
function extractHandleFromUrl(input: string): string {
  if (!/^(https?:)?\/\//i.test(input) && !/^[\w-]+\.[a-z]{2,}\//i.test(input)) {
    return input;
  }

  let parsed: URL;
  try {
    parsed = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    // Not a parseable URL after all; let the character rules reject it with a
    // message about the handle rather than about URL syntax.
    return input;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return input;

  // Rumble is `/c/<slug>` and YouTube can be `/@handle/live`; in both cases the
  // handle is the first segment that is not a routing keyword.
  const ignored = new Set(["c", "channel", "user", "live", "streams", "videos"]);
  const handle = segments.find((segment) => !ignored.has(segment.toLowerCase()));

  return handle ?? input;
}

/** Display name for a platform, used in rejection messages. */
function label(platform: Platform): string {
  const names: Record<Platform, string> = {
    kick: "Kick",
    twitch: "Twitch",
    youtube: "YouTube",
    rumble: "Rumble",
    tiktok: "TikTok",
  };
  return names[platform];
}
