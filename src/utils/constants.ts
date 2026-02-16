import type { Platform } from "../types/index.js";

/**
 * Platform display configuration
 */
export const PLATFORMS: Record<
  Platform,
  { name: string; color: number; emoji: string; urlTemplate: string }
> = {
  kick: {
    name: "Kick",
    color: 0x53fc18, // Green
    emoji: "🟢",
    urlTemplate: "https://kick.com/{username}",
  },
  twitch: {
    name: "Twitch",
    color: 0x9146ff, // Purple
    emoji: "🟣",
    urlTemplate: "https://twitch.tv/{username}",
  },
  youtube: {
    name: "YouTube",
    color: 0xff0000, // Red
    emoji: "🔴",
    urlTemplate: "https://youtube.com/@{username}",
  },
  rumble: {
    name: "Rumble",
    color: 0x85c742, // Green
    emoji: "🟢",
    urlTemplate: "https://rumble.com/c/{username}",
  },
  tiktok: {
    name: "TikTok",
    color: 0x010101, // Black
    emoji: "⚫",
    urlTemplate: "https://tiktok.com/@{username}/live",
  },
};

/**
 * Get URL for a streamer
 */
export function getStreamUrl(platform: Platform, username: string): string {
  return PLATFORMS[platform].urlTemplate.replace("{username}", username);
}

/**
 * Polling interval in milliseconds (60 seconds)
 */
export const POLL_INTERVAL = 60 * 1000;

/**
 * Items per page for pagination
 */
export const ITEMS_PER_PAGE = 10;

/**
 * Embed colors
 */
export const Colors = {
  SUCCESS: 0x57f287,
  ERROR: 0xed4245,
  WARNING: 0xfee75c,
  INFO: 0x5865f2,
  DEFAULT: 0x2b2d31,
} as const;

/**
 * Embed footer
 */
export const FOOTER = {
  text: "Streamer Alerts Bot",
  iconURL: undefined as string | undefined,
};

/**
 * Platform choices for slash commands
 */
export const PLATFORM_CHOICES = Object.entries(PLATFORMS).map(
  ([value, config]) => ({
    name: config.name,
    value: value as Platform,
  }),
);
