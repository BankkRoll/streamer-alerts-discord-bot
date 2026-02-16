import {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  AnySelectMenuInteraction,
} from "discord.js";
import type { StreamerBot } from "../client/StreamerBot.js";
import { handleButton } from "../handlers/buttons.js";
import { handleSelectMenu } from "../handlers/selectMenus.js";
import { createErrorEmbed } from "../components/embeds.js";
import { logger } from "../utils/logger.js";

/**
 * Handle all interactions
 */
export async function handleInteraction(
  client: StreamerBot,
  interaction: Interaction,
): Promise<void> {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      await handleCommand(client, interaction);
      return;
    }

    // Handle button clicks
    if (interaction.isButton()) {
      await handleButton(interaction as ButtonInteraction);
      return;
    }

    // Handle select menus
    if (interaction.isAnySelectMenu()) {
      await handleSelectMenu(interaction as AnySelectMenuInteraction);
      return;
    }

    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const command = client.getCommand(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }
  } catch (error) {
    logger.error("Error handling interaction:", error);

    // Try to send error response
    try {
      const errorEmbed = createErrorEmbed(
        "Error",
        "An unexpected error occurred. Please try again.",
      );

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      }
    } catch {
      // Ignore if we can't send error response
    }
  }
}

/**
 * Handle slash command interactions
 */
async function handleCommand(
  client: StreamerBot,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const command = client.getCommand(interaction.commandName);

  if (!command) {
    logger.warn(`Unknown command: ${interaction.commandName}`);
    await interaction.reply({
      embeds: [
        createErrorEmbed("Unknown Command", "This command does not exist."),
      ],
      ephemeral: true,
    });
    return;
  }

  await command.execute(interaction);
}
