/**
 * Component and modal interaction handlers.
 *
 * Routing is driven by the compact custom-id codec rather than raw string
 * prefixes, so a stale id from a previous deployment decodes to `null` and is
 * declined politely instead of throwing.
 *
 * Every response here re-sends `MessageFlags.IsComponentsV2`. Discord requires
 * the flag on each edit of a V2 message, not only on the original send.
 *
 * @module handlers/components
 */

import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import type {
  ButtonInteraction,
  Guild,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { decodeCustomId, readIntArg } from "../lib/custom-id.js";
import { ADD_MODAL_FIELDS } from "../ui/modals.js";
import {
  buildListPanel,
  buildNotice,
  buildRemoveConfirmPanel,
} from "../ui/panels.js";
import { getRepository } from "../services/context.js";
import { createStreamerId } from "../storage/index.js";
import { validateUsername } from "../platforms/validation.js";
import { isPlatform } from "../types/streamer.js";
import type { Streamer } from "../types/streamer.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Flags every V2 response in this module carries. */
const PRIVATE_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** An interaction that can be replied to or updated with a V2 payload. */
type RespondableInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

/** Reply privately with a V2 payload. */
async function replyPrivate(
  interaction: RespondableInteraction,
  payload: { components: unknown[] },
): Promise<void> {
  await interaction.reply({ ...payload, flags: PRIVATE_V2 } as never);
}

/** Replace the originating message with a V2 payload. */
async function updateMessage(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  payload: { components: unknown[] },
): Promise<void> {
  await interaction.update({
    ...payload,
    flags: MessageFlags.IsComponentsV2,
  } as never);
}

/**
 * Confirm the bot can actually post in a channel before promising alerts.
 *
 * Checked at add time because the alternative is a streamer that appears
 * tracked and silently never alerts.
 *
 * @param guild - Guild owning the channel.
 * @param channelId - Channel selected for alerts.
 * @returns `null` when usable, otherwise a reason to show the user.
 */
async function checkChannelUsable(
  guild: Guild,
  channelId: string,
): Promise<string | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) return "That channel no longer exists.";
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    return "Alerts can only be posted to text or announcement channels.";
  }

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return "Could not determine the bot's permissions in this server.";

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return `I cannot see <#${channelId}>.`;
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return `I cannot send messages in <#${channelId}>.`;
  }

  return null;
}

/**
 * Handle submission of the add-streamer modal.
 *
 * @param interaction - The modal submission.
 */
export async function handleAddModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Server only", "Add streamers from inside a server."),
    );
    return;
  }

  const [platformValue] = interaction.fields.getStringSelectValues(
    ADD_MODAL_FIELDS.platform,
  );
  const rawUsername = interaction.fields
    .getTextInputValue(ADD_MODAL_FIELDS.username)
    .trim();
  const channels = interaction.fields.getSelectedChannels(
    ADD_MODAL_FIELDS.channel,
    false,
  );
  const roles = interaction.fields.getSelectedRoles(
    ADD_MODAL_FIELDS.role,
    false,
  );

  if (!platformValue || !isPlatform(platformValue)) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Unknown platform", "Pick a platform from the list."),
    );
    return;
  }

  const validation = validateUsername(platformValue, rawUsername);
  if (!validation.ok) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Invalid username", validation.reason),
    );
    return;
  }

  const channel = channels?.first();
  if (!channel) {
    await replyPrivate(
      interaction,
      buildNotice("error", "No channel selected", "Choose an alert channel."),
    );
    return;
  }

  const unusable = await checkChannelUsable(interaction.guild, channel.id);
  if (unusable) {
    await replyPrivate(
      interaction,
      buildNotice("error", "Cannot use that channel", unusable),
    );
    return;
  }

  const streamer: Streamer = {
    id: createStreamerId(platformValue, validation.normalised),
    platform: platformValue,
    username: validation.normalised,
    channelId: channel.id,
    mentionRoleId: roles?.first()?.id,
    isLive: false,
    addedAt: new Date().toISOString(),
    addedBy: interaction.user.id,
  };

  const result = await getRepository().addStreamer(
    interaction.guildId,
    streamer,
  );

  if (!result.ok) {
    const message =
      result.reason === "duplicate"
        ? `**${validation.normalised}** is already tracked on that platform.`
        : `This server has reached the limit of ${config.limits.maxStreamersPerGuild} tracked streamers.`;
    await replyPrivate(
      interaction,
      buildNotice("warning", "Not added", message),
    );
    return;
  }

  const mention = streamer.mentionRoleId
    ? ` and will ping <@&${streamer.mentionRoleId}>`
    : "";
  await replyPrivate(
    interaction,
    buildNotice(
      "success",
      "Streamer tracked",
      `**${validation.normalised}** will alert in <#${channel.id}>${mention}.`,
    ),
  );
}

/**
 * Handle the removal picker's selection.
 *
 * @param interaction - The select interaction.
 */
export async function handleRemoveSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.inGuild()) return;

  const [streamerId] = interaction.values;
  if (!streamerId) return;

  const streamer = await getRepository().getStreamer(
    interaction.guildId,
    streamerId,
  );

  // The streamer may have been removed by someone else between render and
  // click, so the absence is reported rather than treated as an error.
  if (!streamer) {
    await updateMessage(
      interaction,
      buildNotice(
        "warning",
        "Already removed",
        "That streamer is no longer tracked.",
      ),
    );
    return;
  }

  await updateMessage(interaction, buildRemoveConfirmPanel(streamer));
}

/**
 * Handle a button press.
 *
 * @param interaction - The button interaction.
 */
export async function handleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const decoded = decodeCustomId(interaction.customId);

  // Ids from an older deployment decode to null; acknowledge silently so the
  // client does not show "interaction failed".
  if (!decoded) {
    await interaction.deferUpdate();
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.deferUpdate();
    return;
  }

  const repository = getRepository();

  switch (decoded.action) {
    case "remove:confirm": {
      const [streamerId] = decoded.args;
      if (!streamerId) {
        await interaction.deferUpdate();
        return;
      }

      const removed = await repository.removeStreamer(
        interaction.guildId,
        streamerId,
      );
      await updateMessage(
        interaction,
        removed
          ? buildNotice("success", "Streamer removed", "Alerts have stopped.")
          : buildNotice(
              "warning",
              "Already removed",
              "That streamer was no longer tracked.",
            ),
      );
      return;
    }

    case "remove:cancel": {
      await updateMessage(
        interaction,
        buildNotice("info", "Cancelled", "Nothing was removed."),
      );
      return;
    }

    case "list:page":
    case "list:refresh": {
      const page = readIntArg(decoded.args, 0, 0);
      const streamers = await repository.getStreamers(interaction.guildId);
      await updateMessage(interaction, buildListPanel(streamers, page));
      return;
    }

    case "noop": {
      await interaction.deferUpdate();
      return;
    }

    default: {
      logger.debug(`Unhandled button action: ${decoded.action}`);
      await interaction.deferUpdate();
    }
  }
}

/**
 * Handle a select-menu interaction.
 *
 * @param interaction - The select interaction.
 */
export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const decoded = decodeCustomId(interaction.customId);

  if (!decoded) {
    await interaction.deferUpdate();
    return;
  }

  switch (decoded.action) {
    case "remove:select":
      await handleRemoveSelect(interaction);
      return;

    default:
      logger.debug(`Unhandled select action: ${decoded.action}`);
      await interaction.deferUpdate();
  }
}

/**
 * Handle a modal submission.
 *
 * @param interaction - The modal submission.
 */
export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const decoded = decodeCustomId(interaction.customId);

  if (!decoded) {
    await replyPrivate(
      interaction,
      buildNotice(
        "error",
        "Expired form",
        "This form is from an older version of the bot. Run the command again.",
      ),
    );
    return;
  }

  switch (decoded.action) {
    case "add:modal":
      await handleAddModal(interaction);
      return;

    default:
      logger.debug(`Unhandled modal action: ${decoded.action}`);
      await replyPrivate(interaction, buildNotice("error", "Unknown form"));
  }
}
