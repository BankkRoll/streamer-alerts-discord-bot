/**
 * Supported streaming platforms
 */
export type Platform = "kick" | "twitch" | "youtube" | "rumble" | "tiktok";

/**
 * Streamer data stored in the database
 */
export interface Streamer {
  /** Unique identifier: "platform:username" */
  id: string;
  /** Streaming platform */
  platform: Platform;
  /** Platform username/handle */
  username: string;
  /** Display name (if different from username) */
  displayName?: string;
  /** Discord channel ID for notifications */
  channelId: string;
  /** Current live status */
  isLive: boolean;
  /** Last time detected live (ISO timestamp) */
  lastLiveAt?: string;

  // Live data (updated each poll)
  /** Current stream title */
  title?: string;
  /** Current viewer count */
  viewers?: number;
  /** Follower/subscriber count */
  followers?: number;
  /** Stream thumbnail URL */
  thumbnail?: string;
  /** Profile image URL */
  profileImage?: string;
  /** Stream start time (ISO timestamp) */
  startedAt?: string;
  /** Verified status on platform */
  verified?: boolean;
  /** Bio/description */
  bio?: string;
}

/**
 * Live status returned by platform checkers
 */
export interface LiveStatus {
  /** Whether the streamer is currently live */
  isLive: boolean;
  /** Platform name */
  platform: Platform;
  /** Username checked */
  username: string;
  /** Stream title */
  title?: string;
  /** Current viewer count */
  viewers?: number;
  /** Follower/subscriber count */
  followers?: number;
  /** Stream thumbnail URL */
  thumbnail?: string;
  /** Profile image URL */
  profileImage?: string;
  /** Stream start time (ISO timestamp) */
  startedAt?: string;
  /** Direct URL to the stream */
  url: string;
  /** Verified status */
  verified?: boolean;
  /** Bio/description */
  bio?: string;
  /** Stream category/game */
  category?: string;
  /** Category icon URL */
  categoryIcon?: string;
  /** Stream tags */
  tags?: string[];
  /** Stream language */
  language?: string;
  /** Whether stream is marked as mature */
  isMature?: boolean;
  /** Error message if check failed */
  error?: string;
}

/**
 * Guild settings stored in Enmap
 */
export interface GuildSettings {
  /** Array of tracked streamers */
  streamers: Streamer[];
}

/**
 * Function signature for platform checkers
 */
export type PlatformChecker = (username: string) => Promise<LiveStatus>;

/**
 * Platform configuration
 */
export interface PlatformConfig {
  /** Display name */
  name: string;
  /** Embed color (hex as number) */
  color: number;
  /** Platform emoji */
  emoji: string;
  /** URL template with {username} placeholder */
  urlTemplate: string;
  /** Platform checker function */
  checker: PlatformChecker;
}
