import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} from "discord.js";
import type { Streamer, Platform } from "../types/index.js";
import { PLATFORMS } from "../utils/constants.js";
import { encodeCustomId } from "../types/discord.js";

/**
 * Create a channel select menu for choosing notification channel
 */
export function createChannelSelect(
  platform: Platform,
  username: string,
): ActionRowBuilder<ChannelSelectMenuBuilder> {
  const customId = encodeCustomId({
    action: "channel_select",
    platform,
    username,
  });

  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a channel for notifications")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menu);
}

/**
 * Create a string select menu for selecting a streamer to remove
 */
export function createStreamerSelect(
  streamers: Streamer[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const customId = encodeCustomId({ action: "streamer_select" });

  const options = streamers.slice(0, 25).map((s) => {
    const platform = PLATFORMS[s.platform];
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${s.username}`)
      .setDescription(`${platform.name} • Alerts in #${s.channelId.slice(-4)}`)
      .setValue(s.id)
      .setEmoji(platform.emoji);
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a streamer to remove")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Create a platform select menu
 */
export function createPlatformSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  const customId = encodeCustomId({ action: "platform_select" });

  const options = Object.entries(PLATFORMS).map(([value, config]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(config.name)
      .setValue(value)
      .setEmoji(config.emoji),
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a platform")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
