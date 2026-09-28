/**
 * Zero-dependency JSON file storage driver.
 *
 * This is the default backend and requires nothing beyond Node's standard
 * library. It keeps the whole dataset in memory and persists it as a single
 * pretty-printed JSON document.
 *
 * Durability strategy:
 *
 * 1. Writes are debounced, so the burst a poll cycle produces collapses into
 *    one disk write instead of one per streamer.
 * 2. Each write goes to a temporary file which is then renamed over the
 *    target. Rename is atomic within a filesystem, so a crash can never leave
 *    a half-written primary file.
 * 3. The previous good file is retained as `.bak` before each replacement.
 * 4. On load, a corrupt primary falls back to the backup. If both are
 *    unreadable the driver throws rather than silently starting empty, because
 *    starting empty would cause the next write to destroy recoverable data.
 *
 * @module storage/json
 */

import {
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { copyFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageDriver, StorageValue } from "./types.js";

/** Options accepted by {@link JsonStorageDriver}. */
export interface JsonStorageOptions {
  /** Directory that will hold the data file and its backup. */
  directory: string;
  /** File name within {@link JsonStorageOptions.directory}. */
  filename?: string;
  /** Delay before flushing pending writes. `0` disables debouncing. */
  writeDebounceMs?: number;
  /** Invoked for recoverable problems, such as falling back to the backup. */
  onWarning?: (message: string, error?: unknown) => void;
}

/** Raised when neither the primary file nor its backup can be parsed. */
export class StorageCorruptionError extends Error {
  public constructor(path: string, cause: unknown) {
    super(
      `Storage file at ${path} is unreadable and no usable backup exists. ` +
        `Refusing to start with an empty dataset, because the next write would ` +
        `overwrite recoverable data. Inspect or remove the file to continue.`,
    );
    this.name = "StorageCorruptionError";
    this.cause = cause;
  }
}

/**
 * File-backed storage driver with atomic writes and backup recovery.
 *
 * @example
 * ```ts
 * const driver = new JsonStorageDriver({ directory: "./data" });
 * await driver.init();
 * await driver.set("guild:123", { streamers: [] });
 * await driver.close();
 * ```
 */
export class JsonStorageDriver implements StorageDriver {
  public readonly name = "json";

  readonly #file: string;
  readonly #backup: string;
  readonly #temp: string;
  readonly #debounceMs: number;
  readonly #onWarning: (message: string, error?: unknown) => void;

  #cache = new Map<string, StorageValue>();
  #timer: NodeJS.Timeout | undefined;
  /** In-flight or queued write, awaited by {@link JsonStorageDriver.flush}. */
  #pending: Promise<void> = Promise.resolve();
  /**
   * Resolver for the debounced {@link JsonStorageDriver.#pending} promise.
   *
   * Held in a field rather than captured solely by the timer callback: when
   * {@link JsonStorageDriver.flush} cancels the timer it must still settle the
   * promise, or every awaiting caller — including `close()` — hangs forever
   * and the pending data is never written.
   */
  #releasePending: (() => void) | undefined;
  #dirty = false;
  #closed = false;

  public constructor(options: JsonStorageOptions) {
    const directory = resolve(options.directory);
    this.#file = join(directory, options.filename ?? "storage.json");
    this.#backup = `${this.#file}.bak`;
    this.#temp = `${this.#file}.tmp`;
    this.#debounceMs = options.writeDebounceMs ?? 250;
    this.#onWarning = options.onWarning ?? ((): void => {});
  }

  public async init(): Promise<void> {
    const directory = dirname(this.#file);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    // A leftover temp file means a previous process died mid-write. The
    // primary is still intact in that case, so the temp is simply stale.
    if (existsSync(this.#temp)) {
      await unlink(this.#temp).catch((): void => {});
    }

    this.#cache = this.#load();
  }

  /**
   * Load the dataset, preferring the primary file and falling back to the
   * backup when it cannot be parsed.
   */
  #load(): Map<string, StorageValue> {
    if (!existsSync(this.#file)) {
      // A backup without a primary means a crash between rename steps.
      if (existsSync(this.#backup)) {
        try {
          const recovered = this.#parse(this.#backup);
          this.#onWarning(
            `Primary storage file was missing; recovered ${recovered.size} entries from backup.`,
          );
          return recovered;
        } catch (error) {
          throw new StorageCorruptionError(this.#file, error);
        }
      }
      return new Map();
    }

    try {
      return this.#parse(this.#file);
    } catch (primaryError) {
      if (existsSync(this.#backup)) {
        try {
          const recovered = this.#parse(this.#backup);
          this.#onWarning(
            `Primary storage file was corrupt; recovered ${recovered.size} entries from backup.`,
            primaryError,
          );
          return recovered;
        } catch {
          throw new StorageCorruptionError(this.#file, primaryError);
        }
      }
      throw new StorageCorruptionError(this.#file, primaryError);
    }
  }

  /** Parse one file into a map, rejecting anything that is not a JSON object. */
  #parse(path: string): Map<string, StorageValue> {
    const raw = readFileSync(path, "utf8");

    // An empty file is a legitimate "nothing stored yet" state.
    if (raw.trim().length === 0) return new Map();

    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      const actual = Array.isArray(parsed) ? "an array" : typeof parsed;
      throw new TypeError(`Expected a JSON object at ${path}, received ${actual}`);
    }
    return new Map(Object.entries(parsed as Record<string, StorageValue>));
  }

  public async get<T extends StorageValue>(key: string): Promise<T | undefined> {
    const value = this.#cache.get(key);
    // Clone on read so callers cannot mutate cached state and accidentally
    // persist changes they never asked to save.
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  public async set<T extends StorageValue>(
    key: string,
    value: T,
  ): Promise<void> {
    this.#assertOpen();
    this.#cache.set(key, structuredClone(value));
    this.#scheduleWrite();
    return this.#pending;
  }

  public async delete(key: string): Promise<boolean> {
    this.#assertOpen();
    const existed = this.#cache.delete(key);
    if (existed) {
      this.#scheduleWrite();
      await this.#pending;
    }
    return existed;
  }

  public async keys(): Promise<string[]> {
    return [...this.#cache.keys()];
  }

  public async clear(): Promise<void> {
    this.#assertOpen();
    this.#cache.clear();
    this.#scheduleWrite();
    return this.#pending;
  }

  /** Force any debounced write to complete now. */
  public async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      // Cancelling the timer destroys the only path that would have settled
      // the debounced promise, so settle it here before anything awaits it.
      this.#releasePending?.();
      this.#releasePending = undefined;
    }
    if (this.#dirty) {
      this.#pending = this.#pending.then((): Promise<void> => this.#write());
    }
    await this.#pending;
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      await this.#pending;
      return;
    }
    await this.flush();
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error(
        "Storage driver has been closed and cannot accept writes",
      );
    }
  }

  /**
   * Mark the dataset dirty and arrange for a write.
   *
   * Chaining onto the pending promise serialises writes, so two overlapping
   * flushes can never interleave and produce a torn file.
   */
  #scheduleWrite(): void {
    this.#dirty = true;

    if (this.#debounceMs === 0) {
      this.#pending = this.#pending.then((): Promise<void> => this.#write());
      return;
    }

    if (this.#timer) return;

    this.#pending = new Promise<void>((resolvePending) => {
      this.#releasePending = resolvePending;
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#releasePending = undefined;
        void this.#write().then(resolvePending, resolvePending);
      }, this.#debounceMs);
      // Never hold the process open purely to flush a cache write.
      this.#timer.unref?.();
    });
  }

  /** Write the dataset atomically: temp file, backup rotation, then rename. */
  async #write(): Promise<void> {
    if (!this.#dirty) return;
    this.#dirty = false;

    const serialised = JSON.stringify(Object.fromEntries(this.#cache), null, 2);

    try {
      await writeFile(this.#temp, serialised, "utf8");

      // Keep the last good file. COPYFILE_FICLONE lets the OS use a
      // copy-on-write clone where the filesystem supports it.
      if (existsSync(this.#file)) {
        await copyFile(
          this.#file,
          this.#backup,
          fsConstants.COPYFILE_FICLONE,
        ).catch((): Promise<void> => copyFile(this.#file, this.#backup));
      }

      await rename(this.#temp, this.#file);
    } catch (error) {
      // Leave the dataset dirty so a later flush retries this write.
      this.#dirty = true;
      await unlink(this.#temp).catch((): void => {});
      throw error;
    }
  }
}
