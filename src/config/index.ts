/**
 * Typed, validated application configuration.
 *
 * Every tunable in the bot resolves here. Values come from environment
 * variables with documented defaults; the whole object is validated once at
 * import time so a misconfigured deploy fails immediately with an actionable
 * message instead of misbehaving at runtime.
 *
 * @module config
 */

import "dotenv/config";

/** Storage backends selectable via `STORAGE_DRIVER`. */
export const STORAGE_DRIVERS = ["json", "memory", "keyv"] as const;

/** A storage backend identifier. */
export type StorageDriverName = (typeof STORAGE_DRIVERS)[number];

/** Log levels, ordered from most to least verbose. */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

/** A log level identifier. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Collected validation failures, reported together rather than one at a time. */
class ConfigError extends Error {
  public constructor(issues: readonly string[]) {
    super(
      `Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}\n\n` +
        `See .env.example for the full list of supported variables.`,
    );
    this.name = "ConfigError";
  }
}

const issues: string[] = [];

/**
 * Read a required string. Records an issue when absent so that every problem
 * surfaces in a single error rather than failing on the first one.
 */
function requireString(key: string): string {
  const raw = process.env[key]?.trim();
  if (!raw) {
    issues.push(`${key} is required but was not set`);
    return "";
  }
  return raw;
}

/** Read an optional string, falling back to `fallback` when unset or blank. */
function optionalString(key: string, fallback: string): string {
  const raw = process.env[key]?.trim();
  // A blank value counts as unset, so this cannot be ?? (which keeps "").
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return raw ? raw : fallback;
}

/** Read an optional string that may legitimately be absent. */
function nullableString(key: string): string | undefined {
  const raw = process.env[key]?.trim();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return raw ? raw : undefined;
}

/**
 * Read an integer within an inclusive range.
 *
 * Out-of-range and non-numeric values are recorded as issues rather than
 * silently clamped, because a typo in a poll interval should be loud.
 */
function integer(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    issues.push(`${key} must be an integer, received "${raw}"`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    issues.push(`${key} must be between ${min} and ${max}, received ${parsed}`);
    return fallback;
  }
  return parsed;
}

/** Read a boolean from the usual truthy/falsy spellings. */
function boolean(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  issues.push(`${key} must be a boolean, received "${raw}"`);
  return fallback;
}

/** Read a value constrained to a fixed set of allowed strings. */
function enumValue<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (!allowed.includes(raw as T)) {
    issues.push(`${key} must be one of ${allowed.join(", ")}, received "${raw}"`);
    return fallback;
  }
  return raw as T;
}

const discord = {
  /** Bot token used to authenticate the gateway and REST connections. */
  token: requireString("DISCORD_TOKEN"),
  /** Application id, required to register slash commands. */
  clientId: requireString("CLIENT_ID"),
  /** When set, commands deploy to this guild instantly instead of globally. */
  guildId: nullableString("GUILD_ID"),
  /**
   * Reconcile slash commands with Discord during startup.
   *
   * The sync compares before it writes, so a normal restart costs one read and
   * nothing else. Disable it only if commands are managed by a separate
   * deployment step.
   */
  syncCommands: boolean("SYNC_COMMANDS_ON_START", true),
} as const;

const storage = {
  /** Which backend persists guild state. `json` requires no extra packages. */
  driver: enumValue("STORAGE_DRIVER", STORAGE_DRIVERS, "json"),
  /** Directory holding the JSON driver's data and backup files. */
  path: optionalString("STORAGE_PATH", "./data"),
  /**
   * Delay before batching pending writes to disk. Coalesces the burst of
   * updates a poll cycle produces into a single file write.
   */
  writeDebounceMs: integer("STORAGE_WRITE_DEBOUNCE_MS", 250, 0, 60_000),
  /** Connection string for the `keyv` driver, e.g. `sqlite://data/bot.sqlite`. */
  connectionString: nullableString("STORAGE_CONNECTION_STRING"),
} as const;

const polling = {
  /** Gap between poll cycles. Discord-independent; bounded by platform politeness. */
  intervalMs: integer("POLL_INTERVAL_MS", 60_000, 10_000, 3_600_000),
  /** Abort an individual platform request after this long. */
  requestTimeoutMs: integer("REQUEST_TIMEOUT_MS", 10_000, 1_000, 120_000),
  /** Retry attempts for a failed platform request, excluding the first try. */
  maxRetries: integer("REQUEST_MAX_RETRIES", 2, 0, 10),
  /** How many streamers are checked concurrently within one cycle. */
  concurrency: integer("POLL_CONCURRENCY", 5, 1, 50),
  /**
   * Suppress a repeat alert for the same streamer within this window, so a
   * flapping platform response cannot spam a channel.
   */
  alertCooldownMs: integer("ALERT_COOLDOWN_MS", 1_800_000, 0, 86_400_000),
  /**
   * Consecutive failures before a streamer is marked unhealthy and backed off.
   */
  failureThreshold: integer("POLL_FAILURE_THRESHOLD", 5, 1, 100),
} as const;

const ui = {
  /** Streamers listed per page. Bounded so a page cannot exceed the V2 budget. */
  itemsPerPage: integer("ITEMS_PER_PAGE", 5, 1, 10),
  /** How long list and confirmation components stay interactive. */
  interactionTimeoutMs: integer("INTERACTION_TIMEOUT_MS", 300_000, 10_000, 900_000),
  /** Default per-command cooldown when a command does not declare its own. */
  defaultCooldownMs: integer("DEFAULT_COOLDOWN_MS", 3_000, 0, 300_000),
} as const;

const limits = {
  /** Maximum streamers a single guild may track. */
  maxStreamersPerGuild: integer("MAX_STREAMERS_PER_GUILD", 100, 1, 1_000),
} as const;

const runtime = {
  /** Minimum severity that reaches the log output. */
  logLevel: enumValue("LOG_LEVEL", LOG_LEVELS, "info"),
  /** Emit machine-readable JSON lines instead of human-formatted output. */
  logJson: boolean("LOG_JSON", false),
  /** Present the bot's tracked-streamer count as its activity status. */
  presenceEnabled: boolean("PRESENCE_ENABLED", true),
  /** How often the presence string refreshes. */
  presenceIntervalMs: integer("PRESENCE_INTERVAL_MS", 300_000, 30_000, 3_600_000),
} as const;

if (storage.driver === "keyv" && !storage.connectionString) {
  issues.push(
    `STORAGE_CONNECTION_STRING is required when STORAGE_DRIVER is "keyv" ` +
      `(for example sqlite://data/bot.sqlite)`,
  );
}

if (issues.length > 0) {
  throw new ConfigError(issues);
}

/**
 * The resolved, validated configuration.
 *
 * @example
 * ```ts
 * import { config } from "./config/index.js";
 * setInterval(poll, config.polling.intervalMs);
 * ```
 */
export const config = {
  discord,
  storage,
  polling,
  ui,
  limits,
  runtime,
} as const;

/** Shape of {@link config}, useful for typing functions that accept overrides. */
export type Config = typeof config;
