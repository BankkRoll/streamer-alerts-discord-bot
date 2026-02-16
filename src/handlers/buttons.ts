import { ButtonInteraction } from "discord.js";
import { decodeCustomId } from "../types/discord.js";
import { removeStreamer, getStreamers } from "../database/index.js";
import {
  createSuccessEmbed,
  createErrorEmbed,
  createListEmbed,
} from "../components/embeds.js";
import { createPaginationButtons } from "../components/buttons.js";
import { ITEMS_PER_PAGE } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

/**
 * Handle button interactions
 */
export async function handleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const data = decodeCustomId(interaction.customId);

  if (!data) {
    // Handle static button IDs
    if (interaction.customId === "page_current") {
      await interaction.deferUpdate();
      return;
    }
    return;
  }

  switch (data.action) {
    case "confirm_remove":
      await handleConfirmRemove(interaction, data.streamerId);
      break;

    case "cancel":
      await handleCancel(interaction);
      break;

    case "page_prev":
    case "page_next":
      await handlePagination(interaction, data.page ?? 1);
      break;

    default:
      logger.warn(`Unknown button action: ${data.action}`);
  }
}

/**
 * Handle confirm remove button
 */
async function handleConfirmRemove(
  interaction: ButtonInteraction,
  streamerId?: string,
): Promise<void> {
  if (!streamerId || !interaction.guildId) {
    await interaction.update({
      embeds: [createErrorEmbed("Error", "Invalid interaction data.")],
      components: [],
    });
    return;
  }

  const success = removeStreamer(interaction.guildId, streamerId);

  if (success) {
    const [platform, username] = streamerId.split(":");
    await interaction.update({
      embeds: [
        createSuccessEmbed(
          "Streamer Removed",
          `**${username}** (${platform}) has been removed from tracking.`,
        ),
      ],
      components: [],
    });
    logger.info(
      `Removed streamer ${streamerId} from guild ${interaction.guildId}`,
    );
  } else {
    await interaction.update({
      embeds: [
        createErrorEmbed(
          "Error",
          "Failed to remove streamer. It may have already been removed.",
        ),
      ],
      components: [],
    });
  }
}

/**
 * Handle cancel button
 */
async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: "Action cancelled.",
    embeds: [],
    components: [],
  });
}

/**
 * Handle pagination buttons
 */
async function handlePagination(
  interaction: ButtonInteraction,
  page: number,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.deferUpdate();
    return;
  }

  const streamers = getStreamers(interaction.guildId);
  const totalPages = Math.ceil(streamers.length / ITEMS_PER_PAGE) || 1;

  // Ensure page is within bounds
  const safePage = Math.max(1, Math.min(page, totalPages));

  const embed = createListEmbed(streamers, safePage);
  const components =
    totalPages > 1 ? [createPaginationButtons(safePage, totalPages)] : [];

  await interaction.update({
    embeds: [embed],
    components,
  });
}
