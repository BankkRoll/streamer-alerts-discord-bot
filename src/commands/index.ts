/**
 * Command registry.
 *
 * Commands are imported statically rather than discovered by scanning the
 * filesystem: the set is small, static imports are type-checked, and a
 * renamed file becomes a build error instead of a command that silently stops
 * being registered.
 *
 * @module commands
 */

import { Collection } from "discord.js";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { helpCommand } from "./help.js";
import { pingCommand } from "./ping.js";
import { streamerCommand } from "./streamer.js";
import type { Command } from "../types/discord.js";

/** Every command this bot exposes. */
export const commands: readonly Command[] = [
  streamerCommand,
  helpCommand,
  pingCommand,
];

/**
 * Build the name-keyed registry used at dispatch time.
 *
 * @returns Commands keyed by their registered name.
 * @throws When two commands share a name, which would otherwise mean one
 *   silently shadows the other.
 */
export function createCommandRegistry(): Collection<string, Command> {
  const registry = new Collection<string, Command>();

  for (const command of commands) {
    const { name } = command.data;
    if (registry.has(name)) {
      throw new Error(`Duplicate command name registered: ${name}`);
    }
    registry.set(name, command);
  }

  return registry;
}

/**
 * Serialise every command for deployment.
 *
 * @returns Payloads accepted by Discord's bulk command overwrite endpoints.
 */
export function getCommandData(): RESTPostAPIApplicationCommandsJSONBody[] {
  return commands.map(
    (command) => command.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody,
  );
}
