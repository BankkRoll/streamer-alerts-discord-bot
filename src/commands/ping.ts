/**
 * The `/ping` command.
 *
 * @module commands/ping
 */

import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { buildPingPanel } from "../ui/panels.js";
import type { Command } from "../types/discord.js";

/**
 * Report round-trip and gateway latency.
 *
 * Round trip is measured by editing the reply: the gap between the initial
 * response and the edit is the only honest client-observable figure.
 */
export const pingCommand: Command = {
  cooldownMs: 5_000,
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is responsive")
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sentAt = Date.now();

    await interaction.reply({
      ...buildPingPanel(0, interaction.client.ws.ping),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    } as never);

    // The V2 flag has to be repeated on the edit; omitting it is a 400.
    await interaction.editReply({
      ...buildPingPanel(Date.now() - sentAt, interaction.client.ws.ping),
    });
  },
};
