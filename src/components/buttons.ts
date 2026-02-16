import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Platform } from "../types/index.js";
import { PLATFORMS } from "../utils/constants.js";
import { encodeCustomId } from "../types/discord.js";

/**
 * Create a "Watch Stream" button
 */
export function createWatchButton(
  url: string,
  platform: Platform,
): ButtonBuilder {
  const config = PLATFORMS[platform];

  return new ButtonBuilder()
    .setLabel(`Watch on ${config.name}`)
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setEmoji(config.emoji);
}

/**
 * Create confirm/cancel buttons for removal
 */
export function createConfirmButtons(
  streamerId: string,
): ActionRowBuilder<ButtonBuilder> {
  const confirmId = encodeCustomId({ action: "confirm_remove", streamerId });
  const cancelId = encodeCustomId({ action: "cancel" });

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel("Yes, Remove")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Create a cancel button
 */
export function createCancelButton(): ActionRowBuilder<ButtonBuilder> {
  const cancelId = encodeCustomId({ action: "cancel" });

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Create pagination buttons
 */
export function createPaginationButtons(
  currentPage: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> {
  const prevId = encodeCustomId({ action: "page_prev", page: currentPage - 1 });
  const nextId = encodeCustomId({ action: "page_next", page: currentPage + 1 });

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId("page_current")
      .setLabel(`Page ${currentPage}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
  );
}

/**
 * Create an action row with a watch button
 */
export function createWatchButtonRow(
  url: string,
  platform: Platform,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    createWatchButton(url, platform),
  );
}
