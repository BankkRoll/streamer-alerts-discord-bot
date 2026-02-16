import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import type { Command, StreamerBotClient } from "../types/index.js";
import { getTotalStreamerCount } from "../database/index.js";
import { logger } from "../utils/logger.js";

/**
 * Extended Discord client for Streamer Alerts Bot
 */
export class StreamerBot extends Client implements StreamerBotClient {
  public commands: Collection<string, Command>;

  constructor() {
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      partials: [Partials.Channel],
    });

    this.commands = new Collection();
  }

  /**
   * Update the bot's activity status
   */
  public updateActivity(): void {
    const streamerCount = getTotalStreamerCount();
    const serverCount = this.guilds.cache.size;

    this.user?.setActivity({
      name: `${streamerCount} streamers | ${serverCount} servers`,
      type: ActivityType.Watching,
    });
  }

  /**
   * Start the activity rotation
   */
  public startActivityRotation(intervalMs: number = 30_000): void {
    // Set initial activity
    this.updateActivity();

    // Update periodically
    setInterval(() => {
      this.updateActivity();
    }, intervalMs);

    logger.info("Activity rotation started");
  }

  /**
   * Register a command
   */
  public registerCommand(command: Command): void {
    this.commands.set(command.data.name, command);
    logger.debug(`Registered command: ${command.data.name}`);
  }

  /**
   * Get a command by name
   */
  public getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }
}

/**
 * Create and configure the bot client
 */
export function createClient(): StreamerBot {
  return new StreamerBot();
}
