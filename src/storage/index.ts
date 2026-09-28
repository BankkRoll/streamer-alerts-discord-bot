/**
 * Storage driver resolution and the guild repository.
 *
 * The repository is the only part of the bot that knows how guild state is
 * shaped. Everything above it works with domain objects; everything below it
 * works with opaque keys and JSON values.
 *
 * Two concurrency rules are enforced here, because the previous
 * implementation lost data without them:
 *
 * 1. **Reads return copies.** Callers cannot mutate cached state, so a change
 *    only ever lands through an explicit write.
 * 2. **Writes are serialised per guild and re-read inside the lock.** The
 *    poller spends seconds awaiting HTTP between reading and writing, and a
 *    user command landing in that window must not be silently overwritten.
 *
 * @module storage
 */

import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { JsonStorageDriver } from "./json.js";
import { KeyvStorageDriver } from "./keyv.js";
import { MemoryStorageDriver } from "./memory.js";
import type { StorageDriver, StorageValue } from "./types.js";
import type { GuildSettings, Platform, Streamer } from "../types/streamer.js";

export { JsonStorageDriver, StorageCorruptionError } from "./json.js";
export { KeyvStorageDriver, KeyvNotInstalledError } from "./keyv.js";
export { MemoryStorageDriver } from "./memory.js";
export type { StorageDriver, StorageValue } from "./types.js";

/** Current guild-record schema version. */
const SCHEMA_VERSION = 1;

/** Key prefix for guild records, namespacing them from future record types. */
const GUILD_KEY_PREFIX = "guild:";

/** Build the storage key for one guild. */
function guildKey(guildId: string): string {
  return `${GUILD_KEY_PREFIX}${guildId}`;
}

/**
 * Construct the driver named by configuration.
 *
 * @param name - Driver to build. Defaults to the configured driver.
 * @returns An uninitialised driver; call `init()` before use.
 */
export function createDriver(
  name: string = config.storage.driver,
): StorageDriver {
  switch (name) {
    case "memory":
      return new MemoryStorageDriver();

    case "keyv":
      return new KeyvStorageDriver({
        // Validated at config load, so this is non-empty by the time we run.
        connectionString: config.storage.connectionString ?? "",
        onError: (error) => { logger.error("Keyv storage error:", error); },
      });

    case "json":
    default:
      return new JsonStorageDriver({
        directory: config.storage.path,
        filename: "guilds.json",
        writeDebounceMs: config.storage.writeDebounceMs,
        onWarning: (message, error) => { logger.warn(message, error); },
      });
  }
}

/** Default state for a guild that has never been written. */
function emptySettings(): GuildSettings {
  return { streamers: [], version: SCHEMA_VERSION };
}

/**
 * Normalise a stored record, tolerating anything an older version wrote.
 *
 * Hand-edited files and records from previous schema versions both reach this
 * function, so it validates rather than trusts.
 */
function normalise(raw: unknown): GuildSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return emptySettings();
  }

  const record = raw as Partial<GuildSettings>;
  const streamers = Array.isArray(record.streamers) ? record.streamers : [];

  // Drop entries missing the fields every consumer assumes are present.
  const valid = streamers.filter(
    (streamer): streamer is Streamer =>
      typeof streamer === "object" &&
      streamer !== null &&
      typeof streamer.id === "string" &&
      typeof streamer.platform === "string" &&
      typeof streamer.username === "string" &&
      typeof streamer.channelId === "string",
  );

  return {
    streamers: valid.map((streamer) => ({
      ...streamer,
      // Coerced rather than trusted: the type says boolean, but this data
      // comes off disk and may have been hand-edited or written by an older
      // version. `=== true` is deliberate; do not "simplify" it away.
      isLive: (streamer.isLive as unknown) === true,
      addedAt: streamer.addedAt ?? new Date(0).toISOString(),
    })),
    version: SCHEMA_VERSION,
  };
}

/** Outcome of an attempt to add a streamer. */
export type AddStreamerResult =
  | { ok: true; streamer: Streamer }
  | { ok: false; reason: "duplicate" | "limit-reached" };

/**
 * Guild-scoped persistence for tracked streamers.
 *
 * @example
 * ```ts
 * const repo = new GuildRepository(createDriver());
 * await repo.init();
 * await repo.addStreamer("123", streamer);
 * ```
 */
export class GuildRepository {
  readonly #driver: StorageDriver;
  /**
   * Per-guild write chains.
   *
   * Every mutation for a guild appends to that guild's promise chain, so
   * mutations never interleave. Different guilds still proceed in parallel.
   */
  readonly #locks = new Map<string, Promise<unknown>>();

  public constructor(driver: StorageDriver) {
    this.#driver = driver;
  }

  /** Name of the underlying driver, for logs and diagnostics. */
  public get driverName(): string {
    return this.#driver.name;
  }

  /** Prepare the underlying driver. */
  public async init(): Promise<void> {
    await this.#driver.init();
    logger.info(`Storage ready (driver: ${this.#driver.name})`);
  }

  /** Flush pending writes and release the driver. */
  public async close(): Promise<void> {
    // Let queued mutations finish before tearing the driver down.
    await Promise.allSettled([...this.#locks.values()]);
    await this.#driver.close();
  }

  /**
   * Run `mutator` under this guild's write lock.
   *
   * The mutator receives freshly read settings, which is what makes the
   * poller's long await window safe: by the time it writes, it is working
   * from state that already includes any user command that landed meanwhile.
   */
  async #withLock<T>(
    guildId: string,
    mutator: (settings: GuildSettings) => Promise<T> | T,
  ): Promise<T> {
    const previous = this.#locks.get(guildId) ?? Promise.resolve();

    const run = previous.then(
      async (): Promise<T> => {
        const settings = await this.#read(guildId);
        return mutator(settings);
      },
      async (): Promise<T> => {
        // A failed earlier mutation must not poison later ones.
        const settings = await this.#read(guildId);
        return mutator(settings);
      },
    );

    this.#locks.set(
      guildId,
      run.catch((): void => {
        // Swallowed here so the chain survives; the caller still sees it.
      }),
    );

    try {
      return await run;
    } finally {
      // Drop the entry once this is the last queued operation.
      if (this.#locks.get(guildId) === run) {
        this.#locks.delete(guildId);
      }
    }
  }

  /** Read and normalise one guild's settings. */
  async #read(guildId: string): Promise<GuildSettings> {
    const raw = await this.#driver.get<StorageValue>(guildKey(guildId));
    return raw === undefined ? emptySettings() : normalise(raw);
  }

  /** Persist one guild's settings. */
  async #write(guildId: string, settings: GuildSettings): Promise<void> {
    await this.#driver.set(
      guildKey(guildId),
      settings as unknown as StorageValue,
    );
  }

  /**
   * Read a guild's settings.
   *
   * The returned object is a copy; mutating it changes nothing on disk.
   */
  public async getSettings(guildId: string): Promise<GuildSettings> {
    return this.#read(guildId);
  }

  /** List a guild's tracked streamers. */
  public async getStreamers(guildId: string): Promise<Streamer[]> {
    const settings = await this.#read(guildId);
    return settings.streamers;
  }

  /** Fetch one streamer by id, or `undefined` when absent. */
  public async getStreamer(
    guildId: string,
    streamerId: string,
  ): Promise<Streamer | undefined> {
    const streamers = await this.getStreamers(guildId);
    return streamers.find((streamer) => streamer.id === streamerId);
  }

  /**
   * Add a streamer, rejecting duplicates and enforcing the per-guild cap.
   *
   * @returns The stored streamer, or why it could not be added.
   */
  public async addStreamer(
    guildId: string,
    streamer: Streamer,
  ): Promise<AddStreamerResult> {
    return this.#withLock(guildId, async (settings) => {
      if (settings.streamers.some((existing) => existing.id === streamer.id)) {
        return { ok: false, reason: "duplicate" } as const;
      }

      if (settings.streamers.length >= config.limits.maxStreamersPerGuild) {
        return { ok: false, reason: "limit-reached" } as const;
      }

      settings.streamers.push(streamer);
      await this.#write(guildId, settings);
      logger.info(`Added ${streamer.id} to guild ${guildId}`);
      return { ok: true, streamer } as const;
    });
  }

  /** Remove a streamer. Returns `false` when it was not tracked. */
  public async removeStreamer(
    guildId: string,
    streamerId: string,
  ): Promise<boolean> {
    return this.#withLock(guildId, async (settings) => {
      const index = settings.streamers.findIndex(
        (streamer) => streamer.id === streamerId,
      );
      if (index === -1) return false;

      settings.streamers.splice(index, 1);
      await this.#write(guildId, settings);
      logger.info(`Removed ${streamerId} from guild ${guildId}`);
      return true;
    });
  }

  /**
   * Apply a partial update to one streamer.
   *
   * Merging a patch rather than replacing the record is what keeps a poll
   * cycle from clobbering a concurrent edit to an unrelated field.
   */
  public async updateStreamer(
    guildId: string,
    streamerId: string,
    patch: Partial<Streamer>,
  ): Promise<boolean> {
    return this.#withLock(guildId, async (settings) => {
      const index = settings.streamers.findIndex(
        (streamer) => streamer.id === streamerId,
      );
      if (index === -1) return false;

      const current = settings.streamers[index];
      if (!current) return false;

      settings.streamers[index] = { ...current, ...patch, id: current.id };
      await this.#write(guildId, settings);
      return true;
    });
  }

  /**
   * Apply patches to many streamers in one write.
   *
   * Used by the poller: one lock acquisition and one disk write per guild per
   * cycle, rather than one per streamer. Ids absent from the guild are
   * ignored, which is the correct behaviour when a user removed a streamer
   * while the cycle was in flight.
   *
   * @param patches - Map of streamer id to the fields to merge.
   * @returns How many streamers were actually updated.
   */
  public async updateStreamers(
    guildId: string,
    patches: ReadonlyMap<string, Partial<Streamer>>,
  ): Promise<number> {
    if (patches.size === 0) return 0;

    return this.#withLock(guildId, async (settings) => {
      let updated = 0;

      for (const [index, streamer] of settings.streamers.entries()) {
        const patch = patches.get(streamer.id);
        if (!patch) continue;

        settings.streamers[index] = { ...streamer, ...patch, id: streamer.id };
        updated += 1;
      }

      if (updated > 0) {
        await this.#write(guildId, settings);
      }
      return updated;
    });
  }

  /** Remove every streamer that points at `channelId`. */
  public async removeStreamersForChannel(
    guildId: string,
    channelId: string,
  ): Promise<number> {
    return this.#withLock(guildId, async (settings) => {
      const before = settings.streamers.length;
      settings.streamers = settings.streamers.filter(
        (streamer) => streamer.channelId !== channelId,
      );
      const removed = before - settings.streamers.length;

      if (removed > 0) {
        await this.#write(guildId, settings);
        logger.info(
          `Removed ${removed} streamer(s) from guild ${guildId} for deleted channel ${channelId}`,
        );
      }
      return removed;
    });
  }

  /** Delete a guild's record entirely, used when the bot is removed. */
  public async deleteGuild(guildId: string): Promise<boolean> {
    return this.#withLock(guildId, async () =>
      this.#driver.delete(guildKey(guildId)),
    );
  }

  /** List every guild that tracks at least one streamer. */
  public async getActiveGuilds(): Promise<
    { guildId: string; streamers: Streamer[] }[]
  > {
    const keys = await this.#driver.keys();
    const active: { guildId: string; streamers: Streamer[] }[] = [];

    for (const key of keys) {
      if (!key.startsWith(GUILD_KEY_PREFIX)) continue;

      const guildId = key.slice(GUILD_KEY_PREFIX.length);
      const settings = await this.#read(guildId);
      if (settings.streamers.length > 0) {
        active.push({ guildId, streamers: settings.streamers });
      }
    }

    return active;
  }

  /** Count tracked streamers across every guild. */
  public async getTotalStreamerCount(): Promise<number> {
    const guilds = await this.getActiveGuilds();
    return guilds.reduce((total, guild) => total + guild.streamers.length, 0);
  }
}

/**
 * Build the canonical streamer id for a platform and handle.
 *
 * Lowercasing makes the id stable regardless of how the user typed the name.
 */
export function createStreamerId(
  platform: Platform,
  username: string,
): string {
  return `${platform}:${username.toLowerCase()}`;
}

/**
 * Split a streamer id back into its parts.
 *
 * @returns The components, or `null` when `id` is malformed.
 */
export function parseStreamerId(
  id: string,
): { platform: string; username: string } | null {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;

  return {
    platform: id.slice(0, separator),
    username: id.slice(separator + 1),
  };
}
