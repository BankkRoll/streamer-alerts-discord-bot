/**
 * Visual tokens shared by every Components V2 surface.
 *
 * Centralising colour and glyph choices keeps containers consistent and means
 * a rebrand is one file rather than a search across every command.
 *
 * @module ui/theme
 */

import type { Platform, PlatformConfig } from "../types/streamer.js";

/**
 * Per-platform presentation metadata.
 *
 * Colours are each platform's own brand colour, used as the container accent
 * so an alert is identifiable before any text is read.
 */
export const PLATFORMS = {
  kick: {
    name: "Kick",
    color: 0x53fc18,
    emoji: "🟩",
    urlTemplate: "https://kick.com/{username}",
  },
  twitch: {
    name: "Twitch",
    color: 0x9146ff,
    emoji: "🟪",
    urlTemplate: "https://twitch.tv/{username}",
  },
  youtube: {
    name: "YouTube",
    color: 0xff0000,
    emoji: "🟥",
    urlTemplate: "https://youtube.com/@{username}",
  },
  rumble: {
    name: "Rumble",
    color: 0x85c742,
    emoji: "🟢",
    urlTemplate: "https://rumble.com/c/{username}",
  },
  tiktok: {
    name: "TikTok",
    color: 0x69c9d0,
    emoji: "⬛",
    urlTemplate: "https://tiktok.com/@{username}/live",
  },
} as const satisfies Record<Platform, PlatformConfig>;

/** Accent colours for non-platform surfaces. */
export const COLORS = {
  /** Successful mutations. */
  success: 0x57f287,
  /** Failures the user can act on. */
  error: 0xed4245,
  /** Destructive confirmations. */
  warning: 0xfee75c,
  /** Neutral informational surfaces. */
  info: 0x5865f2,
  /** Muted surfaces that should recede. */
  muted: 0x4e5058,
} as const;

/**
 * Glyphs used consistently across surfaces.
 *
 * Stat-row glyphs are deliberately monochrome and geometric. Full-colour
 * emoji (❤️, 🎮, 🕒) render at inconsistent baselines inside a Text Display
 * and compete with the platform accent bar for attention; muted symbols read
 * as labels instead of decoration at the size Discord renders them.
 */
export const GLYPHS = {
  /** Status markers, where colour genuinely carries meaning. */
  live: "🔴",
  offline: "⚫",
  paused: "⏸️",
  warning: "⚠️",
  success: "✅",
  error: "❌",

  /** Stat-row labels, kept monochrome so the row scans as data. */
  viewers: "◉",
  followers: "♥",
  category: "▸",
  clock: "⏱",
  channel: "#",
  role: "@",
} as const;

/**
 * Resolve the canonical URL for a streamer.
 *
 * The handle is percent-encoded because it is user-supplied and would
 * otherwise allow path traversal or query injection into the produced link.
 *
 * @param platform - Platform to build a URL for.
 * @param username - Streamer handle.
 * @returns An absolute URL to the streamer's channel.
 *
 * @example
 * ```ts
 * streamUrl("twitch", "someone"); // "https://twitch.tv/someone"
 * ```
 */
export function streamUrl(platform: Platform, username: string): string {
  return PLATFORMS[platform].urlTemplate.replace(
    "{username}",
    encodeURIComponent(username),
  );
}
