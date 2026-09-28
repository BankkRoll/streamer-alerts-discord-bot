/**
 * Core domain types: platforms, tracked streamers, and live status.
 *
 * @module types/streamer
 */

/** Streaming platforms this bot can poll. */
export const PLATFORM_IDS = [
  "kick",
  "twitch",
  "youtube",
  "rumble",
  "tiktok",
] as const;

/** A supported streaming platform. */
export type Platform = (typeof PLATFORM_IDS)[number];

/**
 * Narrow an arbitrary string to a {@link Platform}.
 *
 * @param value - Candidate platform identifier, typically from user input.
 * @returns `true` when `value` names a supported platform.
 */
export function isPlatform(value: string): value is Platform {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/**
 * A streamer tracked by one guild.
 *
 * Live fields are refreshed every poll and are absent until the first
 * successful check, so every consumer must treat them as optional.
 */
export interface Streamer {
  /** Stable identifier in the form `platform:username`, lowercased. */
  id: string;
  /** Platform this streamer broadcasts on. */
  platform: Platform;
  /** Platform handle, as entered by the user. */
  username: string;
  /** Platform display name when it differs from the handle. */
  displayName?: string;
  /** Discord channel that receives alerts for this streamer. */
  channelId: string;
  /** Role pinged when this streamer goes live. */
  mentionRoleId?: string;
  /** Whether the most recent successful check saw a live stream. */
  isLive: boolean;
  /** ISO timestamp of the last time the streamer was seen live. */
  lastLiveAt?: string;
  /** ISO timestamp of the last alert sent, used to suppress duplicates. */
  lastAlertedAt?: string;
  /** ISO timestamp this streamer was added. */
  addedAt: string;
  /** Discord user id that added this streamer. */
  addedBy?: string;
  /**
   * Whether polling is paused for this streamer.
   *
   * Set automatically when the alert channel becomes unreachable, so a
   * deleted channel does not generate an error every cycle.
   */
  paused?: boolean;
  /** Human-readable reason accompanying {@link Streamer.paused}. */
  pausedReason?: string;
  /** Consecutive failed checks, used for backoff and health reporting. */
  failureCount?: number;

  /** Stream title from the most recent check. */
  title?: string;
  /** Viewer count from the most recent check. */
  viewers?: number;
  /** Follower or subscriber count from the most recent check. */
  followers?: number;
  /** Stream preview image URL. */
  thumbnail?: string;
  /** Profile image URL. */
  profileImage?: string;
  /** ISO timestamp the current stream started. */
  startedAt?: string;
  /** Whether the platform marks this account as verified. */
  verified?: boolean;
  /** Profile biography or description. */
  bio?: string;
  /** Current category or game. */
  category?: string;
}

/**
 * Result of checking one streamer against their platform.
 *
 * A check that fails sets {@link LiveStatus.error} and reports `isLive: false`,
 * so callers never have to distinguish "offline" from "unknown" unless they
 * care to.
 */
export interface LiveStatus {
  /** Whether the streamer is broadcasting right now. */
  isLive: boolean;
  /** Platform that was checked. */
  platform: Platform;
  /** Handle that was checked. */
  username: string;
  /** Canonical URL of the channel or stream. */
  url: string;
  /** Display name reported by the platform. */
  displayName?: string;
  /** Current stream title. */
  title?: string;
  /** Current viewer count. */
  viewers?: number;
  /** Follower or subscriber count. */
  followers?: number;
  /** Stream preview image URL. */
  thumbnail?: string;
  /** Profile image URL. */
  profileImage?: string;
  /** ISO timestamp the stream started. */
  startedAt?: string;
  /** Whether the platform marks this account as verified. */
  verified?: boolean;
  /** Profile biography or description. */
  bio?: string;
  /** Category or game being streamed. */
  category?: string;
  /** Icon representing {@link LiveStatus.category}. */
  categoryIcon?: string;
  /** Free-form tags attached to the stream. */
  tags?: string[];
  /** Stream language code. */
  language?: string;
  /** Whether the stream is flagged as mature. */
  isMature?: boolean;
  /** Populated when the check failed; `isLive` is then not meaningful. */
  error?: string;
}

/** Everything one guild stores. */
export interface GuildSettings {
  /** Streamers tracked by this guild. */
  streamers: Streamer[];
  /** Schema version, used to migrate stored records forward. */
  version?: number;
}

/** Checks whether a single handle is currently live. */
export type PlatformChecker = (
  username: string,
  signal?: AbortSignal,
) => Promise<LiveStatus>;

/** Presentation and routing metadata for one platform. */
export interface PlatformConfig {
  /** Name shown in the UI. */
  name: string;
  /** Accent colour used for containers and buttons. */
  color: number;
  /** Emoji representing the platform. */
  emoji: string;
  /** URL template containing a `{username}` placeholder. */
  urlTemplate: string;
}
