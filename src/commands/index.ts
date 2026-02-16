import type { Command } from "../types/index.js";
import type { StreamerBot } from "../client/StreamerBot.js";
import { logger } from "../utils/logger.js";

// Import commands
import { streamerCommand } from "./streamer/index.js";
import { helpCommand } from "./util/help.js";
import { pingCommand } from "./util/ping.js";

/**
 * All available commands
 */
export const commands: Command[] = [streamerCommand, helpCommand, pingCommand];

/**
 * Register all commands with the client
 */
export function registerCommands(client: StreamerBot): void {
  for (const command of commands) {
    client.registerCommand(command);
  }
  logger.info(`Registered ${commands.length} commands`);
}

/**
 * Get command data for deployment
 */
export function getCommandData() {
  return commands.map((cmd) => cmd.data.toJSON());
}
