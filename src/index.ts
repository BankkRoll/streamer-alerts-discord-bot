/**
 * Application entry point.
 *
 * Startup order matters: configuration validates at import, storage must be
 * ready before any command can run, and the poller only starts once the
 * gateway reports ready.
 *
 * Shutdown is equally deliberate. The JSON storage driver debounces writes, so
 * exiting without flushing would discard whatever the last poll cycle learned.
 *
 * @module index
 */

import { config } from "./config/index.js";
import { StreamerBot } from "./client/StreamerBot.js";
import { registerEvents } from "./events/index.js";
import { syncCommands } from "./services/CommandSync.js";
import { StreamPoller } from "./services/StreamPoller.js";
import { disposeContext, initialiseContext } from "./services/context.js";
import { logger } from "./utils/logger.js";

/** Longest a graceful shutdown may take before the process is forced down. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Guards against concurrent shutdowns from overlapping signals. */
let shuttingDown = false;

/**
 * Start the bot.
 *
 * @throws When login fails, which is fatal and exits the process.
 */
async function main(): Promise<void> {
  logger.info("Starting streamer alerts bot");

  const { repository } = await initialiseContext();

  if (config.discord.syncCommands) {
    try {
      await syncCommands();
    } catch (error) {
      // A failed sync leaves whatever Discord already had registered, which is
      // usually still serviceable. Refusing to start over it would turn a
      // transient API problem into an outage.
      logger.error(
        "Command sync failed; continuing with previously registered commands:",
        error,
      );
    }
  }

  const client = new StreamerBot();
  const poller = new StreamPoller(client, repository);

  registerEvents(client, poller);

  /** Stop accepting work, flush state, and exit. */
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down`);

    // A hung network call must not strand the process; exit anyway after a
    // bounded wait so a supervisor's restart is not delayed indefinitely.
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out; exiting immediately");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      client.stopPresence();
      await poller.stop();
      await client.destroy();
      // Last, so any write the poller queued is flushed to disk.
      await disposeContext();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  // An unhandled rejection leaves the process in an unknown state; log it and
  // keep running, since a single failed request should not end the bot.
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", reason);
  });

  // An uncaught exception is not recoverable. Flush state, then exit non-zero
  // so a supervisor restarts the process.
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", error);
    void shutdown("uncaughtException").finally(() => process.exit(1));
  });

  await client.login(config.discord.token);
}

main().catch((error: unknown) => {
  logger.error("Failed to start:", error);
  process.exit(1);
});
