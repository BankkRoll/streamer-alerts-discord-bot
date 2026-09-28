/**
 * The `/help` command.
 *
 * @module commands/help
 */

import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { buildHelpPanel } from "../ui/panels.js";
import type { Command } from "../types/discord.js";

/**
 * Show what the bot does and which platforms it supports.
 *
 * Available in DMs as well as servers, since the answer is the same either
 * way and a user may want to read it before inviting the bot.
 */
export const helpCommand: Command = {
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show commands and supported platforms")
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      ...buildHelpPanel(),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    } as never);
  },
};
