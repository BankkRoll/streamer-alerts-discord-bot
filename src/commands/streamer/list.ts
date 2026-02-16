import { ChatInputCommandInteraction } from "discord.js";
import { getStreamers } from "../../database/index.js";
import { createListEmbed, createErrorEmbed } from "../../components/embeds.js";
import { createPaginationButtons } from "../../components/buttons.js";
import { ITEMS_PER_PAGE } from "../../utils/constants.js";
import { logger } from "../../utils/logger.js";

/**
 * Handle /streamer list command
 */
export async function handleList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      embeds: [
        createErrorEmbed("Error", "This command can only be used in a server."),
      ],
      ephemeral: true,
    });
    return;
  }

  const streamers = getStreamers(guildId);
  const totalPages = Math.ceil(streamers.length / ITEMS_PER_PAGE) || 1;

  const embed = createListEmbed(streamers, 1);
  const components =
    totalPages > 1 ? [createPaginationButtons(1, totalPages)] : [];

  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });

  logger.command(
    "streamer list",
    interaction.user.tag,
    interaction.guild?.name ?? "Unknown",
  );
}
