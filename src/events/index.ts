/**
 * Gateway event wiring.
 *
 * Handlers are registered explicitly rather than discovered from disk: the set
 * is small and static, so a typo becomes a build error instead of an event
 * that silently stops firing.
 *
 * @module events
 */

import { Events, MessageFlags } from "discord.js";
import type { Interaction } from "discord.js";
import type { StreamerBot } from "../client/StreamerBot.js";
import {
  handleButton,
  handleModalSubmit,
  handleSelectMenu,
} from "../handlers/components.js";
import { buildNotice } from "../ui/panels.js";
import { getCooldowns, getRepository } from "../services/context.js";
import type { StreamPoller } from "../services/StreamPoller.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Flags used for every error reply. */
const PRIVATE_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/**
 * Tell the user something went wrong, whatever state the interaction is in.
 *
 * An interaction that has already been replied to or deferred rejects a second
 * `reply()`, so the correct call is chosen from the interaction's own state.
 */
async function reportError(
  interaction: Interaction,
  title: string,
  body: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;

  const payload = { ...buildNotice("error", title, body), flags: PRIVATE_V2 };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload as never);
    }
  } catch (error) {
    // The token may have expired, or the interaction may already be answered.
    // Nothing more can be done, so this is logged and dropped.
    logger.debug("Could not deliver error response:", error);
  }
}

/** Dispatch a slash command, enforcing its cooldown first. */
async function dispatchCommand(
  client: StreamerBot,
  interaction: Interaction,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Received unknown command: ${interaction.commandName}`);
    await reportError(
      interaction,
      "Unknown command",
      "This command is no longer available. Try again after the bot updates.",
    );
    return;
  }

  const check = getCooldowns().check(
    interaction.commandName,
    interaction.user.id,
    command.cooldownMs,
  );

  if (!check.allowed) {
    await interaction.reply({
      ...buildNotice(
        "warning",
        "Slow down",
        `You can use \`/${interaction.commandName}\` again <t:${check.retryAtUnix}:R>.`,
      ),
      flags: PRIVATE_V2,
    } as never);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    // The user should not be charged a cooldown for the bot's own failure.
    getCooldowns().clear(interaction.commandName, interaction.user.id);
    logger.error(`Command /${interaction.commandName} failed:`, error);
    await reportError(
      interaction,
      "Something went wrong",
      "The command could not be completed. Please try again.",
    );
  }
}

/** Route every interaction type to its handler. */
async function handleInteraction(
  client: StreamerBot,
  interaction: Interaction,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await dispatchCommand(client, interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }
  } catch (error) {
    logger.error("Interaction handler failed:", error);
    await reportError(
      interaction,
      "Something went wrong",
      "That action could not be completed. Please try again.",
    );
  }
}

/**
 * Register every gateway listener.
 *
 * @param client - The client to attach listeners to.
 * @param poller - Poller started once the client is ready.
 */
export function registerEvents(
  client: StreamerBot,
  poller: StreamPoller,
): void {
  client.once(Events.ClientReady, (ready) => {
    logger.info(`Logged in as ${ready.user.tag}`);
    logger.info(`Serving ${ready.guilds.cache.size} guild(s)`);

    client.startPresence(getRepository());
    poller.start();
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(client, interaction);
  });

  // Housekeeping: a guild that removes the bot leaves an orphaned record that
  // the poller would otherwise skip over on every cycle forever.
  client.on(Events.GuildDelete, (guild) => {
    void getRepository()
      .deleteGuild(guild.id)
      .then((deleted) => {
        if (deleted) logger.info(`Removed stored data for guild ${guild.id}`);
      })
      .catch((error: unknown) => {
        logger.error(`Failed to clean up guild ${guild.id}:`, error);
      });
  });

  // A deleted channel means any streamer pointing at it can never alert again.
  client.on(Events.ChannelDelete, (channel) => {
    if (channel.isDMBased()) return;

    void getRepository()
      .removeStreamersForChannel(channel.guild.id, channel.id)
      .catch((error: unknown) => {
        logger.error(`Failed to clean up channel ${channel.id}:`, error);
      });
  });

  client.on(Events.Error, (error) => {
    logger.error("Client error:", error);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn("Client warning:", warning);
  });

  if (config.runtime.logLevel === "debug") {
    client.on(Events.Debug, (message) => {
      logger.debug(message);
    });
  }

  logger.debug("Event handlers registered");
}
