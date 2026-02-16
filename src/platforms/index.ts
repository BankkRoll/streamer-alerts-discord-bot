import type { Platform, PlatformChecker, PlatformConfig } from "./types.js";
import { checkKickLive } from "./kick.js";
import { checkTwitchLive } from "./twitch.js";
import { checkYouTubeLive } from "./youtube.js";
import { checkRumbleLive } from "./rumble.js";
import { checkTikTokLive } from "./tiktok.js";
import { PLATFORMS } from "../utils/constants.js";

/**
 * Platform checker functions
 */
export const platformCheckers: Record<Platform, PlatformChecker> = {
  kick: checkKickLive,
  twitch: checkTwitchLive,
  youtube: checkYouTubeLive,
  rumble: checkRumbleLive,
  tiktok: checkTikTokLive,
};

/**
 * Get the checker function for a platform
 */
export function getChecker(platform: Platform): PlatformChecker {
  return platformCheckers[platform];
}

/**
 * Get platform configuration
 */
export function getPlatformConfig(platform: Platform): PlatformConfig {
  const config = PLATFORMS[platform];
  return {
    ...config,
    checker: platformCheckers[platform],
  };
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(platform: string): platform is Platform {
  return platform in platformCheckers;
}

// Re-export individual checkers
export { checkKickLive } from "./kick.js";
export { checkTwitchLive } from "./twitch.js";
export { checkYouTubeLive } from "./youtube.js";
export { checkRumbleLive } from "./rumble.js";
export { checkTikTokLive } from "./tiktok.js";

// Re-export types
export type {
  Platform,
  LiveStatus,
  PlatformChecker,
  PlatformConfig,
} from "./types.js";
