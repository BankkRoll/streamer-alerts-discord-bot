import { Client } from "discord.js";
import type { Streamer, LiveStatus } from "../types/index.js";
import {
  getAllGuildsWithStreamers,
  updateStreamers,
} from "../database/index.js";
import { getChecker } from "../platforms/index.js";
import { sendLiveAlert } from "./AlertService.js";
import { POLL_INTERVAL } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

/**
 * Cache for tracking last known live data to prevent duplicate alerts
 */
const lastLiveData = new Map<string, { title?: string; isLive: boolean }>();

/**
 * Stream polling service
 */
export class StreamPoller {
  private client: Client;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Start the polling loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("Stream poller is already running");
      return;
    }

    this.isRunning = true;
    logger.info(`Starting stream poller (interval: ${POLL_INTERVAL / 1000}s)`);

    // Run immediately on start
    this.poll();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.poll();
    }, POLL_INTERVAL);
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("Stream poller stopped");
  }

  /**
   * Run a single poll cycle
   */
  private async poll(): Promise<void> {
    const guilds = getAllGuildsWithStreamers();

    if (guilds.length === 0) {
      logger.debug("No guilds with streamers to check");
      return;
    }

    logger.debug(`Polling ${guilds.length} guilds`);

    for (const { guildId, streamers } of guilds) {
      await this.checkGuildStreamers(guildId, streamers);
    }
  }

  /**
   * Check all streamers for a guild
   */
  private async checkGuildStreamers(
    guildId: string,
    streamers: Streamer[],
  ): Promise<void> {
    const updatedStreamers: Streamer[] = [];

    for (const streamer of streamers) {
      try {
        const status = await this.checkStreamer(streamer);
        const updated = await this.processStatus(guildId, streamer, status);
        updatedStreamers.push(updated);
      } catch (error) {
        logger.error(`Error checking ${streamer.id}:`, error);
        updatedStreamers.push(streamer);
      }
    }

    // Save all updated streamers
    updateStreamers(guildId, updatedStreamers);
  }

  /**
   * Check a single streamer's live status
   */
  private async checkStreamer(streamer: Streamer): Promise<LiveStatus> {
    const checker = getChecker(streamer.platform);
    const status = await checker(streamer.username);

    logger.platform(streamer.platform, streamer.username, status.isLive);

    return status;
  }

  /**
   * Process a status update and send alerts if needed
   */
  private async processStatus(
    guildId: string,
    streamer: Streamer,
    status: LiveStatus,
  ): Promise<Streamer> {
    const cacheKey = `${guildId}-${streamer.id}`;
    const lastData = lastLiveData.get(cacheKey);

    // Determine if we should send an alert
    // Alert if: now live AND (wasn't live before OR title changed)
    const shouldAlert =
      status.isLive &&
      (!lastData?.isLive || (status.title && lastData.title !== status.title));

    if (shouldAlert) {
      await sendLiveAlert(this.client, streamer.channelId, status);

      // Update cache
      lastLiveData.set(cacheKey, {
        title: status.title,
        isLive: true,
      });
    }

    // Clean up cache if went offline
    if (!status.isLive && lastData?.isLive) {
      lastLiveData.delete(cacheKey);
    }

    // Return updated streamer data
    return {
      ...streamer,
      isLive: status.isLive,
      lastLiveAt: status.isLive
        ? new Date().toISOString()
        : streamer.lastLiveAt,
      title: status.title ?? streamer.title,
      viewers: status.viewers ?? streamer.viewers,
      followers: status.followers ?? streamer.followers,
      thumbnail: status.thumbnail ?? streamer.thumbnail,
      profileImage: status.profileImage ?? streamer.profileImage,
      startedAt: status.startedAt ?? streamer.startedAt,
      verified: status.verified ?? streamer.verified,
      bio: status.bio ?? streamer.bio,
    };
  }
}

/**
 * Create and return a stream poller instance
 */
export function createStreamPoller(client: Client): StreamPoller {
  return new StreamPoller(client);
}
