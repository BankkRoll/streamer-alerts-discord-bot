import {
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  AnySelectMenuInteraction,
} from "discord.js";
import { decodeCustomId } from "../types/discord.js";
import type { Platform, Streamer } from "../types/index.js";
import {
  addStreamer,
  getStreamer,
  updateStreamer,
  createStreamerId,
} from "../database/index.js";
import {
  createSuccessEmbed,
  createErrorEmbed,
  createRemoveConfirmEmbed,
} from "../components/embeds.js";
import { createConfirmButtons } from "../components/buttons.js";
import { PLATFORMS } from "../utils/constants.js";
import { logger } from "../utils/logger.js";
import { getChecker } from "../platforms/index.js";
import { sendLiveAlert } from "../services/AlertService.js";

/**
 * Handle select menu interactions
 */
export async function handleSelectMenu(
  interaction: AnySelectMenuInteraction,
): Promise<void> {
  const data = decodeCustomId(interaction.customId);

  if (!data) {
    return;
  }

  switch (data.action) {
    case "channel_select":
      if (interaction.isChannelSelectMenu()) {
        await handleChannelSelect(
          interaction,
          data.platform as Platform,
          data.username!,
        );
      }
      break;

    case "streamer_select":
      if (interaction.isStringSelectMenu()) {
        await handleStreamerSelect(interaction);
      }
      break;

    default:
      logger.warn(`Unknown select menu action: ${data.action}`);
  }
}

/**
 * Handle channel selection for adding a streamer
 */
async function handleChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  platform: Platform,
  username: string,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.update({
      embeds: [
        createErrorEmbed("Error", "This command can only be used in a server."),
      ],
      components: [],
    });
    return;
  }

  const channelId = interaction.values[0];

  if (!channelId) {
    await interaction.update({
      embeds: [createErrorEmbed("Error", "No channel selected.")],
      components: [],
    });
    return;
  }

  // Create streamer object
  const streamerId = createStreamerId(platform, username);
  const streamer: Streamer = {
    id: streamerId,
    platform,
    username,
    channelId,
    isLive: false,
  };

  // Add to database
  const success = addStreamer(interaction.guildId, streamer);

  if (!success) {
    await interaction.update({
      embeds: [
        createErrorEmbed(
          "Already Tracking",
          `**${username}** on ${platform} is already being tracked.`,
        ),
      ],
      components: [],
    });
    return;
  }

  const platformConfig = PLATFORMS[platform];
  logger.info(`Added streamer ${streamerId} to guild ${interaction.guildId}`);

  // Immediately check if streamer is live
  try {
    const checker = getChecker(platform);
    const status = await checker(username);

    // Update streamer data with live status
    updateStreamer(interaction.guildId, streamerId, {
      isLive: status.isLive,
      title: status.title,
      viewers: status.viewers,
      followers: status.followers,
      thumbnail: status.thumbnail,
      profileImage: status.profileImage,
      verified: status.verified,
      bio: status.bio,
      lastLiveAt: status.isLive ? new Date().toISOString() : undefined,
    });

    if (status.isLive) {
      // Send immediate alert
      await sendLiveAlert(interaction.client, channelId, status);

      await interaction.update({
        embeds: [
          createSuccessEmbed(
            "Streamer Added",
            `**${username}** (${platformConfig.name}) will send notifications to <#${channelId}>\n\n` +
              `🔴 **They're currently LIVE!** An alert has been sent.`,
          ),
        ],
        components: [],
      });
    } else {
      await interaction.update({
        embeds: [
          createSuccessEmbed(
            "Streamer Added",
            `**${username}** (${platformConfig.name}) will send notifications to <#${channelId}>\n\n` +
              `They're currently offline. You'll be notified when they go live!`,
          ),
        ],
        components: [],
      });
    }
  } catch (error) {
    // Still added, but couldn't check live status
    logger.error(`Error checking live status for ${username}:`, error);
    await interaction.update({
      embeds: [
        createSuccessEmbed(
          "Streamer Added",
          `**${username}** (${platformConfig.name}) will send notifications to <#${channelId}>`,
        ),
      ],
      components: [],
    });
  }
}

/**
 * Handle streamer selection for removal
 */
async function handleStreamerSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.update({
      embeds: [
        createErrorEmbed("Error", "This command can only be used in a server."),
      ],
      components: [],
    });
    return;
  }

  const streamerId = interaction.values[0];

  if (!streamerId) {
    await interaction.update({
      embeds: [createErrorEmbed("Error", "No streamer selected.")],
      components: [],
    });
    return;
  }

  // Get streamer info
  const streamer = getStreamer(interaction.guildId, streamerId);

  if (!streamer) {
    await interaction.update({
      embeds: [
        createErrorEmbed(
          "Error",
          "Streamer not found. It may have already been removed.",
        ),
      ],
      components: [],
    });
    return;
  }

  // Show confirmation
  const embed = createRemoveConfirmEmbed(streamer);
  const buttons = createConfirmButtons(streamerId);

  await interaction.update({
    embeds: [embed],
    components: [buttons],
  });
}
