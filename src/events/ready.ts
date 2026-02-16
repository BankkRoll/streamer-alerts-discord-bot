import type { StreamerBot } from "../client/StreamerBot.js";
import { createStreamPoller } from "../services/StreamPoller.js";
import { logger } from "../utils/logger.js";

/**
 * Handle the ready event
 */
export function handleReady(client: StreamerBot): void {
  logger.info(`Logged in as ${client.user?.tag}`);
  logger.info(`Serving ${client.guilds.cache.size} guilds`);

  // Start activity rotation
  client.startActivityRotation();

  // Start stream polling
  const poller = createStreamPoller(client);
  poller.start();

  logger.info("Bot is ready!");
}
