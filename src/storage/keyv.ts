/**
 * Optional Keyv-backed storage driver.
 *
 * Keyv is **not** a declared dependency. This module imports it dynamically so
 * that the package only has to exist when an operator actually selects
 * `STORAGE_DRIVER=keyv`; the default JSON driver keeps the install
 * dependency-free.
 *
 * Install what the chosen connection string needs, for example:
 *
 * ```sh
 * npm install keyv @keyv/sqlite
 * ```
 *
 * @module storage/keyv
 */

import type { StorageDriver, StorageValue } from "./types.js";

/**
 * The slice of Keyv's surface this driver relies on.
 *
 * Declared structurally so the project never needs Keyv's type definitions at
 * build time, which keeps `npm run typecheck` working without the package.
 */
interface KeyvLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  disconnect?(): Promise<void>;
  on(event: "error", handler: (error: unknown) => void): unknown;
  iterator?: () => AsyncIterable<[string, unknown]>;
}

/** Options accepted by {@link KeyvStorageDriver}. */
export interface KeyvStorageOptions {
  /** Connection string, for example `sqlite://data/bot.sqlite`. */
  connectionString: string;
  /** Namespace prefix, keeping this bot's keys distinct in a shared store. */
  namespace?: string;
  /**
   * Called when the underlying store emits an error.
   *
   * Keyv emits `error` on connection problems, and an unhandled `error` event
   * terminates the process, so a handler is always attached.
   */
  onError?: (error: unknown) => void;
}

/** Raised when `keyv` is selected but not installed. */
export class KeyvNotInstalledError extends Error {
  public constructor(cause: unknown) {
    super(
      `STORAGE_DRIVER is set to "keyv" but the keyv package could not be loaded. ` +
        `Install it along with the adapter for your connection string, for example: ` +
        `npm install keyv @keyv/sqlite`,
    );
    this.name = "KeyvNotInstalledError";
    this.cause = cause;
  }
}

/**
 * Storage driver delegating to a Keyv instance.
 *
 * @example
 * ```ts
 * const driver = new KeyvStorageDriver({
 *   connectionString: "sqlite://data/bot.sqlite",
 * });
 * await driver.init();
 * ```
 */
export class KeyvStorageDriver implements StorageDriver {
  public readonly name = "keyv";

  readonly #options: KeyvStorageOptions;
  #keyv: KeyvLike | undefined;
  /** Mirrors written keys, since not every Keyv adapter supports iteration. */
  readonly #knownKeys = new Set<string>();

  public constructor(options: KeyvStorageOptions) {
    this.#options = options;
  }

  public async init(): Promise<void> {
    let module: { Keyv?: unknown; default?: unknown };
    try {
      // Built from a variable so TypeScript does not attempt to resolve the
      // specifier at build time: `keyv` is an optional peer that most installs
      // will not have, and a static import would break `npm run typecheck`
      // for everyone using the default JSON driver.
      const specifier = "keyv";
      module = (await import(/* @vite-ignore */ specifier)) as typeof module;
    } catch (error) {
      throw new KeyvNotInstalledError(error);
    }

    // Keyv 5 exports a named `Keyv`; older releases default-export it.
    const KeyvConstructor = (module.Keyv ?? module.default) as
      | (new (uri: string, options?: Record<string, unknown>) => KeyvLike)
      | undefined;

    if (typeof KeyvConstructor !== "function") {
      throw new KeyvNotInstalledError(
        new TypeError("The keyv module did not export a constructor"),
      );
    }

    const keyv = new KeyvConstructor(this.#options.connectionString, {
      namespace: this.#options.namespace ?? "streamer-alerts",
    });

    // An unhandled `error` event on Keyv takes the whole process down.
    keyv.on("error", (error: unknown) => {
      this.#options.onError?.(error);
    });

    this.#keyv = keyv;

    // Seed known keys where the adapter supports iteration, so `keys()` is
    // accurate for data written by a previous run.
    if (typeof keyv.iterator === "function") {
      try {
        for await (const [key] of keyv.iterator()) {
          this.#knownKeys.add(key);
        }
      } catch {
        // Iteration is best-effort; adapters may not implement it.
      }
    }
  }

  public async get<T extends StorageValue>(key: string): Promise<T | undefined> {
    return this.#client().get<T>(key);
  }

  public async set<T extends StorageValue>(
    key: string,
    value: T,
  ): Promise<void> {
    await this.#client().set(key, value);
    this.#knownKeys.add(key);
  }

  public async delete(key: string): Promise<boolean> {
    const deleted = await this.#client().delete(key);
    this.#knownKeys.delete(key);
    return deleted;
  }

  public async keys(): Promise<string[]> {
    const keyv = this.#client();

    if (typeof keyv.iterator === "function") {
      const keys: string[] = [];
      try {
        for await (const [key] of keyv.iterator()) {
          keys.push(key);
        }
        return keys;
      } catch {
        // Fall through to the mirrored set.
      }
    }

    return [...this.#knownKeys];
  }

  public async clear(): Promise<void> {
    await this.#client().clear();
    this.#knownKeys.clear();
  }

  public async close(): Promise<void> {
    await this.#keyv?.disconnect?.();
    this.#keyv = undefined;
  }

  /** Return the initialised client, or explain that `init` was skipped. */
  #client(): KeyvLike {
    if (!this.#keyv) {
      throw new Error("KeyvStorageDriver.init() must be awaited before use");
    }
    return this.#keyv;
  }
}
