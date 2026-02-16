import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { GuildSettings, Streamer, Platform } from "../types/index.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DB_FILE = join(DATA_DIR, "guilds.json");

/**
 * In-memory cache of guild settings
 */
let cache: Map<string, GuildSettings> = new Map();

/**
 * Default guild settings
 */
const defaultSettings: GuildSettings = {
  streamers: [],
};

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load database from disk
 */
function loadFromDisk(): void {
  ensureDataDir();

  if (existsSync(DB_FILE)) {
    try {
      const data = readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data) as Record<string, GuildSettings>;
      cache = new Map(Object.entries(parsed));
      logger.info(`Loaded ${cache.size} guilds from database`);
    } catch (error) {
      logger.error("Failed to load database:", error);
      cache = new Map();
    }
  } else {
    cache = new Map();
    logger.info("No existing database found, starting fresh");
  }
}

/**
 * Save database to disk
 */
function saveToDisk(): void {
  ensureDataDir();

  try {
    const data = Object.fromEntries(cache);
    writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    logger.error("Failed to save database:", error);
  }
}

// Load database on module initialization
loadFromDisk();

/**
 * Get guild settings
 */
export function getGuildSettings(guildId: string): GuildSettings {
  if (!cache.has(guildId)) {
    cache.set(guildId, { ...defaultSettings, streamers: [] });
  }
  return cache.get(guildId)!;
}

/**
 * Get all streamers for a guild
 */
export function getStreamers(guildId: string): Streamer[] {
  return getGuildSettings(guildId).streamers;
}

/**
 * Get a specific streamer
 */
export function getStreamer(
  guildId: string,
  streamerId: string,
): Streamer | undefined {
  return getStreamers(guildId).find((s) => s.id === streamerId);
}

/**
 * Add a streamer to a guild
 */
export function addStreamer(guildId: string, streamer: Streamer): boolean {
  const settings = getGuildSettings(guildId);

  // Check for duplicates
  if (settings.streamers.some((s) => s.id === streamer.id)) {
    return false;
  }

  settings.streamers.push(streamer);
  cache.set(guildId, settings);
  saveToDisk();
  logger.info(`Added streamer ${streamer.id} to guild ${guildId}`);
  return true;
}

/**
 * Remove a streamer from a guild
 */
export function removeStreamer(guildId: string, streamerId: string): boolean {
  const settings = getGuildSettings(guildId);
  const index = settings.streamers.findIndex((s) => s.id === streamerId);

  if (index === -1) {
    return false;
  }

  settings.streamers.splice(index, 1);
  cache.set(guildId, settings);
  saveToDisk();
  logger.info(`Removed streamer ${streamerId} from guild ${guildId}`);
  return true;
}

/**
 * Update a streamer's data
 */
export function updateStreamer(
  guildId: string,
  streamerId: string,
  data: Partial<Streamer>,
): boolean {
  const settings = getGuildSettings(guildId);
  const index = settings.streamers.findIndex((s) => s.id === streamerId);

  if (index === -1) {
    return false;
  }

  settings.streamers[index] = { ...settings.streamers[index], ...data };
  cache.set(guildId, settings);
  saveToDisk();
  return true;
}

/**
 * Update multiple streamers at once
 */
export function updateStreamers(guildId: string, streamers: Streamer[]): void {
  const settings = getGuildSettings(guildId);
  settings.streamers = streamers;
  cache.set(guildId, settings);
  saveToDisk();
}

/**
 * Create a streamer ID
 */
export function createStreamerId(platform: Platform, username: string): string {
  return `${platform}:${username.toLowerCase()}`;
}

/**
 * Parse a streamer ID
 */
export function parseStreamerId(
  id: string,
): { platform: Platform; username: string } | null {
  const [platform, username] = id.split(":");
  if (!platform || !username) return null;
  return { platform: platform as Platform, username };
}

/**
 * Get all guilds with tracked streamers
 */
export function getAllGuildsWithStreamers(): Array<{
  guildId: string;
  streamers: Streamer[];
}> {
  const result: Array<{ guildId: string; streamers: Streamer[] }> = [];

  cache.forEach((settings, guildId) => {
    if (settings.streamers.length > 0) {
      result.push({ guildId, streamers: settings.streamers });
    }
  });

  return result;
}

/**
 * Get total streamer count across all guilds
 */
export function getTotalStreamerCount(): number {
  let count = 0;
  cache.forEach((settings) => {
    count += settings.streamers.length;
  });
  return count;
}
