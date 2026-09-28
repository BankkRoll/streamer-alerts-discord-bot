/**
 * In-memory storage driver.
 *
 * Nothing is persisted, so every restart begins empty. Useful for tests and
 * for ephemeral deployments where the streamer list is provisioned elsewhere.
 *
 * @module storage/memory
 */

import type { StorageDriver, StorageValue } from "./types.js";

/**
 * Volatile storage driver backed by a plain `Map`.
 *
 * @example
 * ```ts
 * const driver = new MemoryStorageDriver();
 * await driver.init();
 * await driver.set("guild:123", { streamers: [] });
 * ```
 */
export class MemoryStorageDriver implements StorageDriver {
  public readonly name = "memory";

  readonly #cache = new Map<string, StorageValue>();

  public async init(): Promise<void> {
    // Nothing to prepare; the map is ready on construction.
  }

  public async get<T extends StorageValue>(key: string): Promise<T | undefined> {
    const value = this.#cache.get(key);
    // Clone so callers cannot mutate stored state through the returned object,
    // matching the persistent drivers' behaviour.
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  public async set<T extends StorageValue>(
    key: string,
    value: T,
  ): Promise<void> {
    this.#cache.set(key, structuredClone(value));
  }

  public async delete(key: string): Promise<boolean> {
    return this.#cache.delete(key);
  }

  public async keys(): Promise<string[]> {
    return [...this.#cache.keys()];
  }

  public async clear(): Promise<void> {
    this.#cache.clear();
  }

  public async close(): Promise<void> {
    this.#cache.clear();
  }
}
