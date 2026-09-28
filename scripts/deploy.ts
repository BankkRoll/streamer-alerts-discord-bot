/**
 * Slash command deployment.
 *
 * Run this whenever a command's definition changes — its name, description, or
 * options. Changing only a command's implementation needs no redeployment.
 *
 * Guild deployment is instant and is the right choice while developing.
 * Global deployment reaches every server but can take up to an hour to
 * propagate, so it is reserved for release.
 *
 * @module scripts/deploy
 */

import { REST, Routes } from "discord.js";
import { config } from "../src/config/index.js";
import { getCommandData } from "../src/commands/index.js";

/** Deploy every command, then report what landed where. */
async function deploy(): Promise<void> {
  const commands = getCommandData();
  const rest = new REST().setToken(config.discord.token);

  const target = config.discord.guildId
    ? Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId,
      )
    : Routes.applicationCommands(config.discord.clientId);

  const scope = config.discord.guildId
    ? `guild ${config.discord.guildId}`
    : "globally";

  console.log(`Deploying ${commands.length} command(s) ${scope}…`);

  // `put` replaces the whole command set, so a command deleted from the
  // registry disappears from Discord rather than lingering.
  const result = (await rest.put(target, { body: commands })) as unknown[];

  console.log(`Deployed ${result.length} command(s) ${scope}.`);
  for (const command of commands) {
    console.log(`  /${command.name} — ${command.description}`);
  }

  if (!config.discord.guildId) {
    console.log("\nGlobal commands can take up to an hour to appear.");
  }
}

deploy().catch((error: unknown) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
