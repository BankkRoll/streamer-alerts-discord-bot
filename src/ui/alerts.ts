/**
 * Live alert composition using Components V2.
 *
 * An alert is a single Container: an accent bar in the platform's colour, a
 * Section pairing the headline with the streamer's avatar, optional stat and
 * tag lines, a Media Gallery for the stream preview, and a link button.
 *
 * Every field a platform provides is optional in practice — scrapers lose
 * fields when a site changes — so each block is conditional and the alert
 * degrades to a headline plus a link rather than failing.
 *
 * @module ui/alerts
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";
import { assertWithinBudget } from "./budget.js";
import { COLORS, GLYPHS, PLATFORMS } from "./theme.js";
import {
  discordTimestamp,
  formatNumber,
  safeText,
} from "../utils/formatters.js";
import type { LiveStatus, Streamer } from "../types/streamer.js";

/** A payload ready to pass to `send`, `reply`, `update`, or `edit`. */
export interface V2Payload {
  /** Top-level components forming the message body. */
  components: APIMessageTopLevelComponent[];
  /** Message flags; always includes `IsComponentsV2`. */
  flags: number;
  /** Mention control, set explicitly so a rendered title cannot ping. */
  allowedMentions: { parse: never[]; roles?: string[] };
}

/** Longest stream title rendered before truncation. */
const MAX_TITLE_LENGTH = 240;

/** Longest category name rendered before truncation. */
const MAX_CATEGORY_LENGTH = 64;

/** Hard ceiling on tags shown, before the width budget is also applied. */
const MAX_TAGS_SHOWN = 5;

/**
 * Character budget for the whole tag row.
 *
 * A count alone is not enough: five short tags fit on one line, while five
 * verbose ones ("relaxing sleep music") wrap to a second line and push the
 * preview down. Budgeting by rendered width keeps the row to a single line
 * regardless of how long individual tags are.
 */
const MAX_TAG_ROW_LENGTH = 58;

/**
 * Validate a URL for use in a component.
 *
 * Scraped URLs reach this function, and Discord rejects the whole message when
 * one is malformed, so anything that is not an absolute http(s) URL is dropped.
 *
 * @param value - Candidate URL.
 * @returns The URL when usable, otherwise `undefined`.
 */
function usableUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Build the stat line, omitting figures the platform did not report. */
function buildStatLine(status: LiveStatus): string | undefined {
  const stats: string[] = [];

  if (status.category) {
    stats.push(
      `${GLYPHS.category} ${safeText(status.category, MAX_CATEGORY_LENGTH)}`,
    );
  }
  if (typeof status.viewers === "number" && status.viewers >= 0) {
    stats.push(`${GLYPHS.viewers} ${formatNumber(status.viewers)}`);
  }
  if (typeof status.followers === "number" && status.followers >= 0) {
    const label = status.platform === "youtube" ? "subscribers" : "followers";
    stats.push(`${GLYPHS.followers} ${formatNumber(status.followers)} ${label}`);
  }
  if (status.startedAt) {
    const started = discordTimestamp(status.startedAt, "R");
    if (started !== "Unknown") stats.push(`${GLYPHS.clock} ${started}`);
  }

  return stats.length > 0 ? stats.join("  •  ") : undefined;
}

/** Build the tag line, or `undefined` when there are no usable tags. */
function buildTagLine(status: LiveStatus): string | undefined {
  if (!status.tags || status.tags.length === 0) return undefined;

  const rendered: string[] = [];
  let width = 0;

  for (const tag of status.tags) {
    if (rendered.length >= MAX_TAGS_SHOWN) break;
    if (tag.trim().length === 0) continue;

    // Backticks render tags as inline code, which also neutralises markdown.
    const formatted = `\`${safeText(tag, 24).replace(/`/g, "")}\``;

    // Always keep the first tag, even if it alone exceeds the budget;
    // an empty row is worse than one slightly wide one.
    if (rendered.length > 0 && width + formatted.length > MAX_TAG_ROW_LENGTH) {
      break;
    }

    rendered.push(formatted);
    width += formatted.length + 1;
  }

  return rendered.length > 0 ? rendered.join(" ") : undefined;
}

/**
 * Compose a live alert.
 *
 * @param status - Result of the platform check that triggered this alert.
 * @param options - Optional role mention to prepend.
 * @returns A payload carrying the `IsComponentsV2` flag.
 *
 * @example
 * ```ts
 * const payload = buildLiveAlert(status, { mentionRoleId: "123" });
 * await channel.send(payload);
 * ```
 */
export function buildLiveAlert(
  status: LiveStatus,
  options: { mentionRoleId?: string } = {},
): V2Payload {
  const platform = PLATFORMS[status.platform];
  const displayName = safeText(status.displayName ?? status.username, 80);
  const verified = status.verified === true ? " ☑️" : "";
  const mature = status.isMature === true ? ` ${GLYPHS.warning} 18+` : "";

  const container = new ContainerBuilder().setAccentColor(platform.color);

  // Headline plus avatar. A Section needs an accessory, so it is only used
  // when there is a usable avatar; otherwise the heading stands alone.
  const avatar = usableUrl(status.profileImage);
  const heading = `## ${GLYPHS.live} ${displayName}${verified} is live on ${platform.name}${mature}`;

  if (avatar) {
    container.addSectionComponents((section) => {
      section.addTextDisplayComponents((text) => text.setContent(heading));

      if (status.title) {
        section.addTextDisplayComponents((text) =>
          text.setContent(safeText(status.title ?? "", MAX_TITLE_LENGTH)),
        );
      }

      return section.setThumbnailAccessory((thumbnail) =>
        thumbnail
          .setURL(avatar)
          .setDescription(`${displayName} profile picture`),
      );
    });
  } else {
    container.addTextDisplayComponents((text) => text.setContent(heading));
    if (status.title) {
      container.addTextDisplayComponents((text) =>
        text.setContent(safeText(status.title ?? "", MAX_TITLE_LENGTH)),
      );
    }
  }

  const statLine = buildStatLine(status);
  const tagLine = buildTagLine(status);

  if (statLine || tagLine) {
    container.addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    if (statLine) {
      container.addTextDisplayComponents((text) => text.setContent(statLine));
    }
    if (tagLine) {
      container.addTextDisplayComponents((text) => text.setContent(tagLine));
    }
  }

  // The preview is the visual anchor of the alert, so it sits last, directly
  // above the call to action.
  const preview = usableUrl(status.thumbnail);
  if (preview) {
    container.addMediaGalleryComponents((gallery) =>
      gallery.addItems((item) =>
        item
          .setURL(preview)
          .setDescription(`${displayName} stream preview`),
      ),
    );
  }

  container.addActionRowComponents<ButtonBuilder>((row) =>
    row.setComponents(
      // Link buttons never emit an interaction, so no handler is needed.
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(`Watch on ${platform.name}`)
        .setURL(status.url),
    ),
  );

  const components: APIMessageTopLevelComponent[] = [container.toJSON()];
  assertWithinBudget(components);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    // Only the configured role may be pinged; a title containing a mention
    // must never notify anyone.
    allowedMentions: options.mentionRoleId
      ? { parse: [], roles: [options.mentionRoleId] }
      : { parse: [] },
  };
}

/**
 * Compose the message replacing an alert once a stream ends.
 *
 * Editing an alert in place keeps a channel readable, and the V2 flag is
 * already set on the original so the edit stays in the same system.
 *
 * @param streamer - Streamer whose stream ended.
 * @param endedAt - When the stream ended; defaults to now.
 * @returns A payload suitable for `message.edit`.
 */
export function buildEndedAlert(
  streamer: Streamer,
  endedAt: Date = new Date(),
): V2Payload {
  const platform = PLATFORMS[streamer.platform];
  const displayName = safeText(streamer.displayName ?? streamer.username, 80);

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.muted)
    .addTextDisplayComponents((text) =>
      text.setContent(
        `## ${GLYPHS.offline} ${displayName} is no longer live\n` +
          `-# Stream ended ${discordTimestamp(endedAt, "R")} on ${platform.name}`,
      ),
    );

  const components: APIMessageTopLevelComponent[] = [container.toJSON()];
  assertWithinBudget(components);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
