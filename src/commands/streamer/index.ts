import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
} from "discord.js";
import type { Command, Platform } from "../../types/index.js";
import { PLATFORM_CHOICES } from "../../utils/constants.js";
import { handleAdd } from "./add.js";
import { handleRemove } from "./remove.js";
import { handleList } from "./list.js";

/**
 * /streamer command with subcommands
 */
export const streamerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("streamer")
    .setDescription("Manage tracked streamers")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a streamer to track")
        .addStringOption((option) =>
          option
            .setName("platform")
            .setDescription("Streaming platform")
            .setRequired(true)
            .addChoices(...PLATFORM_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName("username")
            .setDescription("Streamer username/handle")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("remove").setDescription("Remove a tracked streamer"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List all tracked streamers"),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "add": {
        const platform = interaction.options.getString(
          "platform",
          true,
        ) as Platform;
        const username = interaction.options.getString("username", true);
        await handleAdd(interaction, platform, username);
        break;
      }
      case "remove":
        await handleRemove(interaction);
        break;
      case "list":
        await handleList(interaction);
        break;
    }
  },
};
