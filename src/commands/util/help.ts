import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../types/index.js";
import { createHelpEmbed } from "../../components/embeds.js";
import { logger } from "../../utils/logger.js";

/**
 * /help command
 */
export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show bot help and commands"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = createHelpEmbed();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });

    logger.command(
      "help",
      interaction.user.tag,
      interaction.guild?.name ?? "DM",
    );
  },
};
