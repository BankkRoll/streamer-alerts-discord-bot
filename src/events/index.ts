import { Events } from "discord.js";
import type { StreamerBot } from "../client/StreamerBot.js";
import { handleReady } from "./ready.js";
import { handleInteraction } from "./interactionCreate.js";
import { logger } from "../utils/logger.js";

/**
 * Register all event handlers
 */
export function registerEvents(client: StreamerBot): void {
  // Ready event (once)
  client.once(Events.ClientReady, () => {
    handleReady(client);
  });

  // Interaction create event
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(client, interaction);
  });

  // Error handling
  client.on(Events.Error, (error) => {
    logger.error("Client error:", error);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn("Client warning:", warning);
  });

  // Debug (only in debug mode)
  if (process.env.LOG_LEVEL === "debug") {
    client.on(Events.Debug, (info) => {
      logger.debug("Client debug:", info);
    });
  }

  logger.info("Event handlers registered");
}
