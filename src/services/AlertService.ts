/**
 * Alert delivery.
 *
 * Sending an alert can fail for reasons that are permanent (the channel was
 * deleted, permissions were revoked) or transient (a rate limit, a network
 * blip). The distinction matters: a permanent failure should pause the
 * streamer so the bot stops retrying every cycle, while a transient one
 * should simply be retried next time.
 *
 * @module services/AlertService
 */

import { DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import type { Client, GuildTextBasedChannel } from "discord.js";
import { buildLiveAlert } from "../ui/alerts.js";
import type { LiveStatus, Streamer } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/** Why an alert could not be delivered. */
export type AlertFailure =
  /** The channel or its permissions are gone; stop trying. */
  | { kind: "permanent"; reason: string }
  /** Something temporary; the next cycle may succeed. */
  | { kind: "transient"; reason: string };

/** Outcome of an attempt to deliver an alert. */
export type AlertResult =
  | { ok: true; messageId: string }
  | { ok: false; failure: AlertFailure };

/**
 * Discord error codes meaning the destination is gone for good.
 *
 * Retrying these wastes a request every cycle and never succeeds.
 */
const PERMANENT_ERROR_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

/**
 * Resolve a channel and confirm the bot can post in it.
 *
 * @param client - Logged-in client.
 * @param channelId - Target channel.
 * @returns The channel, or why it cannot be used.
 */
async function resolveChannel(
  client: Client,
  channelId: string,
): Promise<
  { ok: true; channel: GuildTextBasedChannel } | { ok: false; failure: AlertFailure }
> {
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      PERMANENT_ERROR_CODES.has(Number(error.code))
    ) {
      return {
        ok: false,
        failure: { kind: "permanent", reason: `Channel ${channelId} is unreachable` },
      };
    }
    return {
      ok: false,
      failure: { kind: "transient", reason: `Could not fetch channel ${channelId}` },
    };
  }

  if (!channel) {
    return {
      ok: false,
      failure: { kind: "permanent", reason: `Channel ${channelId} no longer exists` },
    };
  }

  // Narrowing via the type guards rather than casting: a cast here would
  // happily accept a DM or forum channel and fail at send time.
  if (!channel.isTextBased() || channel.isDMBased()) {
    return {
      ok: false,
      failure: {
        kind: "permanent",
        reason: `Channel ${channelId} cannot receive alerts`,
      },
    };
  }

  const me = channel.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;

  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return {
      ok: false,
      failure: { kind: "permanent", reason: `Cannot view channel ${channelId}` },
    };
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return {
      ok: false,
      failure: {
        kind: "permanent",
        reason: `Cannot send messages in channel ${channelId}`,
      },
    };
  }

  return { ok: true, channel };
}

/**
 * Send a live alert.
 *
 * @param client - Logged-in client.
 * @param streamer - Streamer that went live.
 * @param status - Result of the check that triggered the alert.
 * @returns The sent message id, or a classified failure.
 *
 * @example
 * ```ts
 * const result = await sendLiveAlert(client, streamer, status);
 * if (!result.ok && result.failure.kind === "permanent") {
 *   await repository.updateStreamer(guildId, streamer.id, { paused: true });
 * }
 * ```
 */
export async function sendLiveAlert(
  client: Client,
  streamer: Streamer,
  status: LiveStatus,
): Promise<AlertResult> {
  const resolved = await resolveChannel(client, streamer.channelId);
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  let payload;
  try {
    payload = buildLiveAlert(status, { mentionRoleId: streamer.mentionRoleId });
  } catch (error) {
    // A build failure means the data violated a component limit. Retrying
    // will not help, but pausing the streamer over it would be excessive.
    logger.error(`Failed to build alert for ${streamer.id}:`, error);
    return {
      ok: false,
      failure: { kind: "transient", reason: "Alert payload was invalid" },
    };
  }

  try {
    const message = await resolved.channel.send(payload);
    logger.info(
      `Alerted ${streamer.id} in #${resolved.channel.name} (${resolved.channel.guild.id})`,
    );
    return { ok: true, messageId: message.id };
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      const code = Number(error.code);
      if (PERMANENT_ERROR_CODES.has(code)) {
        return {
          ok: false,
          failure: {
            kind: "permanent",
            reason: `Discord refused the alert: ${error.message}`,
          },
        };
      }
      return {
        ok: false,
        failure: { kind: "transient", reason: `Discord error ${code}` },
      };
    }

    return {
      ok: false,
      failure: { kind: "transient", reason: "Unexpected error sending alert" },
    };
  }
}
