/**
 * Slash command synchronisation.
 *
 * Runs at startup: fetches what Discord currently has registered, compares it
 * against the local registry, and pushes a replacement set only when they
 * differ. Commands removed from the code disappear from Discord, new ones
 * appear, and changed definitions are updated.
 *
 * **Why the comparison matters.** Discord enforces a daily quota on command
 * creation. Deploying unconditionally on every boot burns that quota, and a
 * crash-looping process can exhaust it and lock itself out. Command
 * definitions change rarely — editing a handler's behaviour needs no
 * redeployment at all — so the overwhelming majority of startups should send
 * no write request. Comparing first turns this from a per-boot write into a
 * single read that usually ends there.
 *
 * @module services/CommandSync
 */

import { REST, Routes } from "discord.js";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { config } from "../config/index.js";
import { getCommandData } from "../commands/index.js";
import { logger } from "../utils/logger.js";

/** What a synchronisation run did. */
export interface CommandSyncResult {
  /** Whether a write to Discord was actually performed. */
  changed: boolean;
  /** Commands present locally but not registered remotely. */
  added: string[];
  /** Commands registered remotely but no longer present locally. */
  removed: string[];
  /** Commands whose definition differs between local and remote. */
  updated: string[];
  /** Where the commands live: a specific guild, or globally. */
  scope: "guild" | "global";
}

/** The subset of a registered command this comparison cares about. */
interface RemoteCommand {
  name: string;
  description?: string;
  options?: unknown;
  default_member_permissions?: string | null;
  contexts?: number[] | null;
  integration_types?: number[] | null;
  nsfw?: boolean;
}

/**
 * Reduce a command definition to a stable, comparable shape.
 *
 * Discord echoes back fields the bot never sets (`id`, `application_id`,
 * `version`, localisation maps, defaulted values), and orders object keys
 * differently from the local builders. Comparing raw payloads would therefore
 * report a difference on every boot and defeat the entire purpose, so both
 * sides are normalised to the fields that actually define behaviour.
 *
 * @param command - A local or remote command definition.
 * @returns A canonical JSON string safe to compare.
 */
function fingerprint(
  command: RESTPostAPIApplicationCommandsJSONBody | RemoteCommand,
): string {
  const source = command as RemoteCommand;

  /**
   * Recursively sort object keys and drop values Discord treats as absent.
   *
   * Discord does not echo back fields left at their default: a subcommand with
   * no options comes back without an `options` key at all, and `required:
   * false` is omitted entirely. The builders, by contrast, emit `options: []`
   * and `required: false` explicitly. Without normalising both away, every
   * command with an optional argument looks changed on every single boot —
   * which is precisely the repeated write this comparison exists to prevent.
   */
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== "object") return value;

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => {
        if (item === undefined || item === null) return false;
        if (Array.isArray(item) && item.length === 0) return false;
        if (item === false) return false;
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    return Object.fromEntries(
      entries.map(([key, item]) => [key, canonical(item)]),
    );
  };

  return JSON.stringify(
    canonical({
      name: source.name,
      description: source.description ?? "",
      options: source.options ?? [],
      // Both sides express this as a string bitfield; only presence differs.
      default_member_permissions: source.default_member_permissions ?? null,
      contexts: source.contexts ?? null,
      nsfw: source.nsfw ?? false,
      // `integration_types` is deliberately excluded: Discord defaults it to
      // [0] on every command while the builders omit it unless set, so
      // comparing it would report a permanent false difference.
    }),
  );
}

/**
 * Bring Discord's registered commands in line with the local registry.
 *
 * Safe to call on every startup: it performs one read, and writes only when
 * the sets genuinely differ.
 *
 * @param rest - Optional pre-configured REST client, primarily for tests.
 * @returns What changed, and whether anything was written.
 *
 * @example
 * ```ts
 * const result = await syncCommands();
 * if (result.changed) logger.info(`Added ${result.added.join(", ")}`);
 * ```
 */
export async function syncCommands(
  rest?: REST,
): Promise<CommandSyncResult> {
  const client = rest ?? new REST().setToken(config.discord.token);
  const local = getCommandData();

  const scope: "guild" | "global" = config.discord.guildId
    ? "guild"
    : "global";

  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId,
      )
    : Routes.applicationCommands(config.discord.clientId);

  const remote = (await client.get(route)) as RemoteCommand[];

  const localByName = new Map(local.map((command) => [command.name, command]));
  const remoteByName = new Map(
    remote.map((command) => [command.name, command]),
  );

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const [name, command] of localByName) {
    const existing = remoteByName.get(name);
    if (!existing) {
      added.push(name);
    } else if (fingerprint(command) !== fingerprint(existing)) {
      updated.push(name);
    }
  }

  for (const name of remoteByName.keys()) {
    if (!localByName.has(name)) removed.push(name);
  }

  const changed =
    added.length > 0 || updated.length > 0 || removed.length > 0;

  if (!changed) {
    logger.info(
      `Commands are up to date (${local.length} registered ${scope === "guild" ? `in guild ${config.discord.guildId ?? ""}` : "globally"})`,
    );
    return { changed: false, added, removed, updated, scope };
  }

  // `put` replaces the entire set, so removals are handled implicitly and no
  // separate delete call is needed.
  await client.put(route, { body: local });

  const summary = [
    added.length > 0 ? `added ${added.join(", ")}` : null,
    updated.length > 0 ? `updated ${updated.join(", ")}` : null,
    removed.length > 0 ? `removed ${removed.join(", ")}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");

  logger.info(`Synced commands ${scope === "guild" ? "to guild" : "globally"}: ${summary}`);

  if (scope === "global") {
    logger.info("Global command changes can take up to an hour to propagate");
  }

  return { changed: true, added, removed, updated, scope };
}
