import { ChatInputCommandInteraction } from "discord.js";
import type { Platform } from "../../types/index.js";
import { getStreamers, createStreamerId } from "../../database/index.js";
import {
  createAddPromptEmbed,
  createErrorEmbed,
} from "../../components/embeds.js";
import { createChannelSelect } from "../../components/menus.js";
import { createCancelButton } from "../../components/buttons.js";
import { logger } from "../../utils/logger.js";

/**
 * Handle /streamer add command
 */
export async function handleAdd(
  interaction: ChatInputCommandInteraction,
  platform: Platform,
  username: string,
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

  // Clean username (remove @ if present)
  const cleanUsername = username.replace(/^@/, "").trim().toLowerCase();

  // Check for duplicate
  const streamerId = createStreamerId(platform, cleanUsername);
  const existingStreamers = getStreamers(guildId);

  if (existingStreamers.some((s) => s.id === streamerId)) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          "Already Tracking",
          `**${cleanUsername}** on ${platform} is already being tracked.`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  // Show channel selection
  const embed = createAddPromptEmbed(platform, cleanUsername);
  const channelSelect = createChannelSelect(platform, cleanUsername);
  const cancelButton = createCancelButton();

  await interaction.reply({
    embeds: [embed],
    components: [channelSelect, cancelButton],
    ephemeral: true,
  });

  logger.command(
    "streamer add",
    interaction.user.tag,
    interaction.guild?.name ?? "Unknown",
  );
}
