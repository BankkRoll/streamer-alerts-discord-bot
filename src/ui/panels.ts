/**
 * Command surfaces built with Components V2.
 *
 * Every panel returns a {@link V2Payload}, so the same object works for an
 * initial reply, a component `update()`, and a later `editReply()`. The
 * `IsComponentsV2` flag is included in all of them because Discord requires it
 * on **every** edit, not just the first send.
 *
 * @module ui/panels
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";
import {
  assertWithinBudget,
  MAX_SELECT_OPTIONS,
  maxRowsPerPage,
} from "./budget.js";
import { COLORS, GLYPHS, PLATFORMS, streamUrl } from "./theme.js";
import type { V2Payload } from "./alerts.js";
import { encodeCustomId } from "../lib/custom-id.js";
import { config } from "../config/index.js";
import {
  discordTimestamp,
  formatNumber,
  safeText,
} from "../utils/formatters.js";
import { PLATFORM_IDS } from "../types/streamer.js";
import type { Streamer } from "../types/streamer.js";

/** Wrap a container into a sendable payload, validating it first. */
function toPayload(container: ContainerBuilder): V2Payload {
  const components: APIMessageTopLevelComponent[] = [container.toJSON()];
  assertWithinBudget(components);
  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/**
 * Build a simple one-message notice.
 *
 * @param tone - Visual treatment; selects the accent colour and glyph.
 * @param title - Short headline.
 * @param body - Optional supporting text.
 * @returns A payload ready to reply with.
 *
 * @example
 * ```ts
 * await interaction.reply({
 *   ...buildNotice("success", "Streamer added"),
 *   flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
 * });
 * ```
 */
export function buildNotice(
  tone: "success" | "error" | "warning" | "info",
  title: string,
  body?: string,
): V2Payload {
  const glyph = {
    success: GLYPHS.success,
    error: GLYPHS.error,
    warning: GLYPHS.warning,
    info: "ℹ️",
  }[tone];

  const container = new ContainerBuilder()
    .setAccentColor(COLORS[tone])
    .addTextDisplayComponents((text) =>
      text.setContent(
        body
          ? `### ${glyph} ${title}\n${body}`
          : `### ${glyph} ${title}`,
      ),
    );

  return toPayload(container);
}

/** How a streamer row renders in the list. */
function describeStreamer(streamer: Streamer): string {
  const platform = PLATFORMS[streamer.platform];
  const name = safeText(streamer.displayName ?? streamer.username, 60);

  const state = streamer.paused
    ? `${GLYPHS.paused} Paused`
    : streamer.isLive
      ? `${GLYPHS.live} Live`
      : `${GLYPHS.offline} Offline`;

  const lines = [`**${name}** ${platform.emoji} ${platform.name} • ${state}`];

  // Channel and role mentions already render their own # and @ prefixes, so
  // an extra glyph here reads as a doubled marker.
  const details: string[] = [`<#${streamer.channelId}>`];
  if (streamer.mentionRoleId) {
    details.push(`<@&${streamer.mentionRoleId}>`);
  }
  if (streamer.isLive && typeof streamer.viewers === "number") {
    details.push(`${GLYPHS.viewers} ${formatNumber(streamer.viewers)}`);
  }
  if (!streamer.isLive && streamer.lastLiveAt) {
    const last = discordTimestamp(streamer.lastLiveAt, "R");
    if (last !== "Unknown") details.push(`last live ${last}`);
  }
  lines.push(`-# ${details.join(" • ")}`);

  if (streamer.paused && streamer.pausedReason) {
    lines.push(`-# ${GLYPHS.warning} ${safeText(streamer.pausedReason, 100)}`);
  }

  return lines.join("\n");
}

/** Pagination state shared by the list panel and its handlers. */
export interface ListPage {
  /** Zero-based page index. */
  index: number;
  /** Total number of pages, at least 1. */
  total: number;
}

/**
 * Components a single list row costs: the Section, its Text Display, and the
 * link button accessory.
 */
const COMPONENTS_PER_ROW = 3;

/**
 * Components the list spends on everything that is not a row: the Container,
 * the header, the header separator, the pagination separator, the pagination
 * Action Row, and its three buttons.
 */
const LIST_CHROME_COMPONENTS = 8;

/**
 * Largest page size that keeps a full page inside the component budget.
 *
 * Derived rather than hardcoded so the list cannot silently start failing if
 * a row gains a component later. Configuration may lower this, never raise it.
 */
const MAX_LIST_PAGE_SIZE = maxRowsPerPage(
  COMPONENTS_PER_ROW,
  LIST_CHROME_COMPONENTS,
);

/**
 * Page size actually used by the list.
 *
 * @returns The configured size, clamped to what the budget allows.
 */
export function listPageSize(): number {
  return Math.min(config.ui.itemsPerPage, MAX_LIST_PAGE_SIZE);
}

/**
 * Resolve a requested page index against the available data.
 *
 * Clamping rather than erroring matters because a user can click a stale
 * pagination button on an old message after streamers were removed.
 *
 * @param requested - Page index the interaction asked for.
 * @param itemCount - How many items exist now.
 * @param pageSize - Items per page.
 * @returns A valid page descriptor.
 */
export function resolvePage(
  requested: number,
  itemCount: number,
  pageSize: number = listPageSize(),
): ListPage {
  const total = Math.max(1, Math.ceil(itemCount / pageSize));
  const index = Math.min(Math.max(0, requested), total - 1);
  return { index, total };
}

/**
 * Build the tracked-streamer list.
 *
 * Each row is a Section whose accessory links to the streamer's channel, so
 * the list doubles as a launcher. Page size comes from configuration and is
 * capped low enough that a full page cannot approach the component budget.
 *
 * @param streamers - Every streamer tracked by the guild.
 * @param pageIndex - Page to render; clamped into range.
 * @returns A payload for reply or update.
 */
export function buildListPanel(
  streamers: readonly Streamer[],
  pageIndex = 0,
): V2Payload {
  const pageSize = listPageSize();
  const page = resolvePage(pageIndex, streamers.length, pageSize);

  const container = new ContainerBuilder().setAccentColor(COLORS.info);

  if (streamers.length === 0) {
    container.addTextDisplayComponents((text) =>
      text.setContent(
        `### 📋 No streamers tracked\n` +
          `Use \`/streamer add\` to start tracking someone.`,
      ),
    );
    return toPayload(container);
  }

  const liveCount = streamers.filter((streamer) => streamer.isLive).length;
  const start = page.index * pageSize;
  const visible = streamers.slice(start, start + pageSize);

  container.addTextDisplayComponents((text) =>
    text.setContent(
      `### 📋 Tracked streamers\n` +
        `-# ${streamers.length} total • ${liveCount} live • page ${page.index + 1}/${page.total}`,
    ),
  );
  container.addSeparatorComponents((separator) =>
    separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  for (const streamer of visible) {
    container.addSectionComponents((section) =>
      section
        .addTextDisplayComponents((text) =>
          text.setContent(describeStreamer(streamer)),
        )
        .setButtonAccessory((button) =>
          button
            .setStyle(ButtonStyle.Link)
            .setLabel("Open")
            .setURL(streamUrl(streamer.platform, streamer.username)),
        ),
    );
  }

  // Pagination only earns its components when there is more than one page.
  if (page.total > 1) {
    container.addSeparatorComponents((separator) =>
      separator.setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addActionRowComponents<ButtonBuilder>((row) =>
      row.setComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId("list:page", [String(page.index - 1)]))
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page.index === 0),
        new ButtonBuilder()
          .setCustomId(encodeCustomId("list:page", [String(page.index + 1)]))
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page.index >= page.total - 1),
        new ButtonBuilder()
          .setCustomId(encodeCustomId("list:refresh", [String(page.index)]))
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  return toPayload(container);
}

/**
 * Build the streamer-removal picker.
 *
 * Discord caps a String Select at 25 options, so guilds tracking more than
 * that see the first 25 alongside a note explaining the cut.
 *
 * @param streamers - Candidates for removal.
 * @returns A payload for reply or update.
 */
export function buildRemovePanel(streamers: readonly Streamer[]): V2Payload {
  if (streamers.length === 0) {
    return buildNotice(
      "info",
      "Nothing to remove",
      "This server is not tracking any streamers yet.",
    );
  }

  const selectable = streamers.slice(0, MAX_SELECT_OPTIONS);
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.warning)
    .addTextDisplayComponents((text) =>
      text.setContent(
        `### 🗑️ Remove a streamer\n` +
          `-# Select which streamer should stop being tracked.`,
      ),
    );

  if (streamers.length > MAX_SELECT_OPTIONS) {
    container.addTextDisplayComponents((text) =>
      text.setContent(
        `-# ${GLYPHS.warning} Showing the first ${MAX_SELECT_OPTIONS} of ` +
          `${streamers.length}. Remove some to see the rest.`,
      ),
    );
  }

  container.addActionRowComponents<StringSelectMenuBuilder>((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(encodeCustomId("remove:select"))
        .setPlaceholder("Choose a streamer to remove")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          selectable.map((streamer) => {
            const platform = PLATFORMS[streamer.platform];
            return new StringSelectMenuOptionBuilder()
              // Option labels cap at 100; 90 leaves room for the platform name.
              .setLabel(safeText(streamer.username, 90))
              .setDescription(
                safeText(
                  `${platform.name} • alerts in #${streamer.channelId}`,
                  100,
                ),
              )
              .setValue(streamer.id);
          }),
        ),
    ),
  );

  return toPayload(container);
}

/**
 * Build the destructive-action confirmation.
 *
 * @param streamer - Streamer queued for removal.
 * @returns A payload for `update()` on the select interaction.
 */
export function buildRemoveConfirmPanel(streamer: Streamer): V2Payload {
  const platform = PLATFORMS[streamer.platform];
  const name = safeText(streamer.displayName ?? streamer.username, 60);

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.warning)
    .addTextDisplayComponents((text) =>
      text.setContent(
        `### ${GLYPHS.warning} Confirm removal\n` +
          `Stop tracking **${name}** on ${platform.name}?\n` +
          `-# Alerts in <#${streamer.channelId}> will no longer be sent.`,
      ),
    )
    .addActionRowComponents<ButtonBuilder>((row) =>
      row.setComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId("remove:confirm", [streamer.id]))
          .setLabel("Remove")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeCustomId("remove:cancel"))
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  return toPayload(container);
}

/**
 * Build the help panel.
 *
 * @returns A payload describing commands and supported platforms.
 */
export function buildHelpPanel(): V2Payload {
  const platformList = PLATFORM_IDS.map((id) => {
    const platform = PLATFORMS[id];
    return `${platform.emoji} ${platform.name}`;
  }).join(" • ");

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.info)
    .addTextDisplayComponents((text) =>
      text.setContent(
        `## 📚 Streamer Alerts\n` +
          `Track streamers and get notified the moment they go live.`,
      ),
    )
    .addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents((text) =>
      text.setContent(
        `**Commands**\n` +
          `\`/streamer add\` — track a new streamer\n` +
          `\`/streamer remove\` — stop tracking someone\n` +
          `\`/streamer list\` — show everyone tracked here\n` +
          `\`/help\` — this panel\n` +
          `\`/ping\` — check bot responsiveness`,
      ),
    )
    .addSeparatorComponents((separator) =>
      separator.setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents((text) =>
      text.setContent(
        `**Supported platforms**\n${platformList}\n` +
          `-# Checks run every ${Math.round(config.polling.intervalMs / 1000)}s. ` +
          `No API keys required.`,
      ),
    );

  return toPayload(container);
}

/**
 * Build the latency panel.
 *
 * @param roundTripMs - Time between command receipt and reply.
 * @param gatewayMs - Websocket heartbeat latency; negative before the first
 *   heartbeat, which is reported rather than shown as a misleading number.
 * @returns A payload for reply or edit.
 */
export function buildPingPanel(
  roundTripMs: number,
  gatewayMs: number,
): V2Payload {
  const gateway =
    gatewayMs < 0 ? "measuring…" : `${Math.round(gatewayMs)}ms`;

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.info)
    .addTextDisplayComponents((text) =>
      text.setContent(
        `### 🏓 Pong\n` +
          `-# Round trip ${Math.round(roundTripMs)}ms • Gateway ${gateway}`,
      ),
    );

  return toPayload(container);
}
