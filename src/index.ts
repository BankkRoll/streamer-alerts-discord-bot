import "dotenv/config";
import { createClient } from "./client/StreamerBot.js";
import { registerCommands } from "./commands/index.js";
import { registerEvents } from "./events/index.js";
import { logger } from "./utils/logger.js";

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Validate environment
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    logger.error("DISCORD_TOKEN is not set in environment variables");
    process.exit(1);
  }

  // Create client
  const client = createClient();

  // Register commands
  registerCommands(client);

  // Register events
  registerEvents(client);

  // Login
  try {
    logger.info("Logging in...");
    await client.login(token);
  } catch (error) {
    logger.error("Failed to login:", error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
});

// Run
main();
