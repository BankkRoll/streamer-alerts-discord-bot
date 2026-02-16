import { ChatInputCommandInteraction } from "discord.js";
import { getStreamers } from "../../database/index.js";
import {
  createRemoveSelectEmbed,
  createErrorEmbed,
} from "../../components/embeds.js";
import { createStreamerSelect } from "../../components/menus.js";
import { createCancelButton } from "../../components/buttons.js";
import { logger } from "../../utils/logger.js";

/**
 * Handle /streamer remove command
 */
export async function handleRemove(
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

  // Get existing streamers
  const streamers = getStreamers(guildId);

  if (streamers.length === 0) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          "No Streamers",
          "No streamers are being tracked.\n\nUse `/streamer add` to add a streamer.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  // Show streamer selection
  const embed = createRemoveSelectEmbed();
  const streamerSelect = createStreamerSelect(streamers);
  const cancelButton = createCancelButton();

  await interaction.reply({
    embeds: [embed],
    components: [streamerSelect, cancelButton],
    ephemeral: true,
  });

  logger.command(
    "streamer remove",
    interaction.user.tag,
    interaction.guild?.name ?? "Unknown",
  );
}
