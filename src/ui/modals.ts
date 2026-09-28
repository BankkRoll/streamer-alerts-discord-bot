/**
 * Modal surfaces built on Label components.
 *
 * Discord restructured modals in August 2025: text inputs no longer sit in
 * Action Rows but inside a `Label`, which also unlocked select menus, file
 * uploads, radio groups and checkboxes as modal children.
 *
 * Note the deliberate limits observed here:
 *
 * - A modal takes **at most 5 top-level components**, and discord.js does
 *   *not* enforce this — a sixth builds cleanly and is rejected by the API.
 * - `Label` text caps at **45** characters, its description at **100**, and
 *   the modal title at **45**.
 * - Modal components must never set `disabled`; use `required` instead.
 *
 * Requires discord.js >= 14.27.0 for the radio and checkbox builders.
 *
 * @module ui/modals
 */

import {
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  TextInputStyle,
} from "discord.js";
import { encodeCustomId } from "../lib/custom-id.js";
import { PLATFORMS } from "./theme.js";
import { PLATFORM_IDS } from "../types/streamer.js";
import type { Platform } from "../types/streamer.js";

/** Discord's cap on top-level modal components, unenforced by discord.js. */
const MAX_MODAL_COMPONENTS = 5;

/** Discord's cap on a `Label`'s text. */
const MAX_LABEL_LENGTH = 45;

/** Discord's cap on a `Label`'s description. */
const MAX_LABEL_DESCRIPTION_LENGTH = 100;

/** Discord's cap on a modal title. */
const MAX_MODAL_TITLE_LENGTH = 45;

/** Field ids read back from a submitted add-streamer modal. */
export const ADD_MODAL_FIELDS = {
  /** String select carrying the chosen platform. */
  platform: "platform",
  /** Text input carrying the streamer handle. */
  username: "username",
  /** Channel select carrying the alert destination. */
  channel: "channel",
  /** Role select carrying an optional ping target. */
  role: "role",
} as const;

/**
 * Guard the limits discord.js does not check.
 *
 * Called at build time so an over-long label fails during development rather
 * than as an opaque 400 when a user opens the modal.
 *
 * @param modal - The assembled modal.
 * @param componentCount - Top-level components added.
 * @throws When a documented Discord limit would be exceeded.
 */
function assertModalValid(modal: ModalBuilder, componentCount: number): void {
  if (componentCount > MAX_MODAL_COMPONENTS) {
    throw new RangeError(
      `Modal has ${componentCount} top-level components, exceeding Discord's ` +
        `limit of ${MAX_MODAL_COMPONENTS}. discord.js does not validate this, ` +
        `so the API would reject it at showModal() time.`,
    );
  }

  const title = modal.toJSON().title;
  if (title !== undefined && title.length > MAX_MODAL_TITLE_LENGTH) {
    throw new RangeError(
      `Modal title is ${title.length} characters, exceeding the ${MAX_MODAL_TITLE_LENGTH} limit.`,
    );
  }
}

/**
 * Build a `Label`, enforcing the text limits.
 *
 * @param label - Heading shown above the wrapped component.
 * @param description - Optional supporting text.
 * @returns A configured label builder.
 */
function label(label: string, description?: string): LabelBuilder {
  if (label.length > MAX_LABEL_LENGTH) {
    throw new RangeError(
      `Label "${label}" is ${label.length} characters, exceeding the ${MAX_LABEL_LENGTH} limit.`,
    );
  }
  if (description && description.length > MAX_LABEL_DESCRIPTION_LENGTH) {
    throw new RangeError(
      `Label description is ${description.length} characters, exceeding the ${MAX_LABEL_DESCRIPTION_LENGTH} limit.`,
    );
  }

  const builder = new LabelBuilder().setLabel(label);
  return description ? builder.setDescription(description) : builder;
}

/**
 * Build the add-streamer modal.
 *
 * Collects everything in one step, replacing the previous multi-message
 * button-and-select sequence. Four top-level components, one under the cap.
 *
 * @param defaultPlatform - Platform preselected in the picker, when known.
 * @returns A modal ready for `interaction.showModal()`.
 *
 * @example
 * ```ts
 * await interaction.showModal(buildAddStreamerModal("twitch"));
 * ```
 */
export function buildAddStreamerModal(
  defaultPlatform?: Platform,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId("add:modal"))
    .setTitle("Track a streamer");

  modal.addLabelComponents(
    label("Platform", "Where does this streamer broadcast?").setStringSelectMenuComponent(
      (select) =>
        select
          .setCustomId(ADD_MODAL_FIELDS.platform)
          .setPlaceholder("Choose a platform")
          .setRequired(true)
          .addOptions(
            PLATFORM_IDS.map((id) => ({
              label: PLATFORMS[id].name,
              value: id,
              default: id === defaultPlatform,
            })),
          ),
    ),

    label("Username", "The handle exactly as it appears on the platform").setTextInputComponent(
      (input) =>
        input
          .setCustomId(ADD_MODAL_FIELDS.username)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("shroud")
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
    ),

    label("Alert channel", "Where live notifications will be posted").setChannelSelectMenuComponent(
      (select) =>
        select
          .setCustomId(ADD_MODAL_FIELDS.channel)
          .setPlaceholder("Choose a channel")
          .setRequired(true)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ),
    ),

    label("Mention role", "Optional role to ping when they go live").setRoleSelectMenuComponent(
      (select) =>
        select
          .setCustomId(ADD_MODAL_FIELDS.role)
          .setPlaceholder("No role")
          // Optional, and `required` lives on the child rather than the label.
          .setRequired(false),
    ),
  );

  assertModalValid(modal, 4);
  return modal;
}
