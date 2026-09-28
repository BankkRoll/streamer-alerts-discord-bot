/**
 * The `/streamer` command group: add, remove, and list tracked streamers.
 *
 * `add` opens a Label-based modal collecting everything in one step. The
 * previous implementation walked the user through a sequence of messages; a
 * modal is one round trip and cannot be left half-finished.
 *
 * @module commands/streamer
 */

import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { buildAddStreamerModal } from "../ui/modals.js";
import { buildListPanel, buildNotice, buildRemovePanel } from "../ui/panels.js";
import { getRepository } from "../services/context.js";
import { isPlatform } from "../types/streamer.js";
import type { Command } from "../types/discord.js";
import { logger } from "../utils/logger.js";

/** Reply ephemerally with a Components V2 payload. */
async function replyPrivate(
  interaction: ChatInputCommandInteraction,
  payload: { components: unknown[]; flags: number },
): Promise<void> {
  await interaction.reply({
    ...payload,
    // Both flags are required: V2 for the component system, Ephemeral so the
    // reply is private. `ephemeral: true` is deprecated in v14.
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  } as never);
}

/** Open the add-streamer modal. */
async function handleAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const requested = interaction.options.getString("platform") ?? undefined;
  // The option is constrained by choices, but a stale client could still send
  // something else, so it is validated rather than cast.
  const platform =
    requested !== undefined && isPlatform(requested) ? requested : undefined;

  // A modal must be the first response; it cannot follow a defer.
  await interaction.showModal(buildAddStreamerModal(platform));
}

/** Show the removal picker. */
async function handleRemove(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Server only", "Run this command inside a server."),
    );
    return;
  }

  const streamers = await getRepository().getStreamers(interaction.guildId);
  await replyPrivate(interaction, buildRemovePanel(streamers));
}

/** Show the tracked-streamer list. */
async function handleList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Server only", "Run this command inside a server."),
    );
    return;
  }

  const streamers = await getRepository().getStreamers(interaction.guildId);
  await replyPrivate(interaction, buildListPanel(streamers, 0));
}

/**
 * The `/streamer` command.
 *
 * Restricted to members who can manage channels, because tracking a streamer
 * causes the bot to post into one. Guild-only: the streamer list is per-guild,
 * so the command is meaningless in a DM.
 */
export const streamerCommand: Command = {
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Manage tracked streamers")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Track a streamer and choose where alerts are posted")
        .addStringOption((option) =>
          option
            .setName("platform")
            .setDescription("Preselect a platform in the form")
            .addChoices(
              { name: "Kick", value: "kick" },
              { name: "Twitch", value: "twitch" },
              { name: "YouTube", value: "youtube" },
              { name: "Rumble", value: "rumble" },
              { name: "TikTok", value: "tiktok" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("remove").setDescription("Stop tracking a streamer"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Show every streamer tracked in this server"),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    switch (subcommand) {
      case "add":
        await handleAdd(interaction);
        return;
      case "remove":
        await handleRemove(interaction);
        return;
      case "list":
        await handleList(interaction);
        return;
      default:
        // Reachable only if a subcommand is registered without a branch here.
        logger.warn(`Unhandled /streamer subcommand: ${subcommand}`);
        await replyPrivate(
          interaction,
          buildNotice("error", "Unknown subcommand"),
        );
    }
  },
};
