import {
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";

/**
 * Command structure
 */
export interface Command {
  /** Slash command data */
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  /** Execute the command */
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /** Handle autocomplete (optional) */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

/**
 * Extended Discord client with commands collection
 */
export interface StreamerBotClient extends Client {
  commands: Collection<string, Command>;
}

/**
 * Button custom ID prefixes for routing
 */
export const ButtonIds = {
  CONFIRM_REMOVE: "confirm_remove",
  CANCEL: "cancel",
  PAGE_PREV: "page_prev",
  PAGE_NEXT: "page_next",
  WATCH_STREAM: "watch_stream",
} as const;

/**
 * Select menu custom ID prefixes
 */
export const SelectMenuIds = {
  CHANNEL_SELECT: "channel_select",
  STREAMER_SELECT: "streamer_select",
  HELP_CATEGORY: "help_category",
} as const;

/**
 * Interaction custom data stored in customId
 */
export interface InteractionData {
  /** Action type */
  action: string;
  /** Streamer ID (platform:username) */
  streamerId?: string;
  /** Page number for pagination */
  page?: number;
  /** Platform for add flow */
  platform?: string;
  /** Username for add flow */
  username?: string;
}

/**
 * Encode interaction data into a customId string
 */
export function encodeCustomId(data: InteractionData): string {
  return JSON.stringify(data);
}

/**
 * Decode a customId string into interaction data
 */
export function decodeCustomId(customId: string): InteractionData | null {
  try {
    return JSON.parse(customId) as InteractionData;
  } catch {
    return null;
  }
}
