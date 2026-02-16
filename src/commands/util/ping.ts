import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../types/index.js";
import { createPingEmbed } from "../../components/embeds.js";
import { logger } from "../../utils/logger.js";

/**
 * /ping command
 */
export const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sent = await interaction.reply({
      content: "🏓 Pinging...",
      ephemeral: true,
      fetchReply: true,
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    const embed = createPingEmbed(latency, apiLatency);

    await interaction.editReply({
      content: "",
      embeds: [embed],
    });

    logger.command(
      "ping",
      interaction.user.tag,
      interaction.guild?.name ?? "DM",
    );
  },
};
