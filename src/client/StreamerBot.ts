/**
 * The Discord client.
 *
 * Intents and caches are deliberately minimal. The bot reads no message
 * content and reacts to no reactions, so holding those caches would cost
 * memory for the life of the process in exchange for nothing.
 *
 * @module client/StreamerBot
 */

import type {
  Collection} from "discord.js";
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Options,
} from "discord.js";
import { config } from "../config/index.js";
import { createCommandRegistry } from "../commands/index.js";
import type { Command, StreamerBotClient } from "../types/discord.js";
import type { GuildRepository } from "../storage/index.js";
import { logger } from "../utils/logger.js";

/**
 * Client preconfigured for this bot's actual needs.
 *
 * @example
 * ```ts
 * const client = new StreamerBot();
 * await client.login(config.discord.token);
 * ```
 */
export class StreamerBot extends Client implements StreamerBotClient {
  /** Commands keyed by name. */
  public readonly commands: Collection<string, Command>;

  #presenceTimer: NodeJS.Timeout | undefined;

  public constructor() {
    super({
      // Guilds alone is enough: the bot only ever posts, and needs the guild
      // and channel objects to do so. GuildMessages was previously enabled
      // without ever reading a message, which only grew the message cache.
      intents: [GatewayIntentBits.Guilds],

      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        // Nothing reads messages or reactions, so caching either is waste.
        MessageManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        GuildMessageManager: 0,
        // Members are fetched on demand for permission checks; keeping the
        // bot's own member object avoids refetching it every alert.
        GuildMemberManager: {
          maxSize: 0,
          keepOverLimit: (member) => member.id === member.client.user.id,
        },
        UserManager: {
          maxSize: 0,
          keepOverLimit: (user) => user.id === user.client.user.id,
        },
        PresenceManager: 0,
        // GuildManager, ChannelManager, GuildChannelManager, RoleManager and
        // PermissionOverwriteManager are documented as unsupported for
        // customisation; changing them breaks library functionality.
      }),

      sweepers: {
        ...Options.DefaultSweeperSettings,
        threads: { interval: 3_600, lifetime: 1_800 },
      },
    });

    this.commands = createCommandRegistry();
  }

  /**
   * Begin refreshing the presence string.
   *
   * @param repository - Source of the tracked-streamer count.
   */
  public startPresence(repository: GuildRepository): void {
    if (!config.runtime.presenceEnabled) return;

    const update = async (): Promise<void> => {
      try {
        const count = await repository.getTotalStreamerCount();
        const guilds = this.guilds.cache.size;
        this.user?.setActivity({
          name: `${count} streamer${count === 1 ? "" : "s"} · ${guilds} server${guilds === 1 ? "" : "s"}`,
          type: ActivityType.Watching,
        });
      } catch (error) {
        // Presence is cosmetic; a failure here must never disrupt the bot.
        logger.debug("Failed to update presence:", error);
      }
    };

    void update();

    this.#presenceTimer = setInterval(() => {
      void update();
    }, config.runtime.presenceIntervalMs);
    this.#presenceTimer.unref?.();
  }

  /** Stop refreshing the presence string. */
  public stopPresence(): void {
    if (this.#presenceTimer) {
      clearInterval(this.#presenceTimer);
      this.#presenceTimer = undefined;
    }
  }
}
