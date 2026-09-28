/**
 * Discord-facing structural types.
 *
 * @module types/discord
 */

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

/** Every builder shape a command's `data` may take. */
export type CommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

/**
 * One slash command.
 *
 * @example
 * ```ts
 * export const ping: Command = {
 *   data: new SlashCommandBuilder().setName("ping").setDescription("Pong"),
 *   cooldownMs: 5_000,
 *   async execute(interaction) {
 *     await interaction.reply("Pong");
 *   },
 * };
 * ```
 */
export interface Command {
  /** Command definition registered with Discord. */
  data: CommandData;
  /**
   * Per-user cooldown for this command.
   *
   * Omit to use the configured default. Set generously on commands that hit
   * external platforms.
   */
  cooldownMs?: number;
  /** Handle an invocation. */
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /** Supply autocomplete choices, when the command declares any. */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

/** Client extended with the command registry. */
export interface StreamerBotClient extends Client {
  /** Commands keyed by name. */
  commands: Collection<string, Command>;
}
