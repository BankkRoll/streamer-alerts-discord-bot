/**
 * Storage driver contract.
 *
 * Drivers are deliberately dumb: they persist opaque JSON-serialisable values
 * under string keys and know nothing about guilds or streamers. All domain
 * logic lives in the repository layer above them, so adding a backend never
 * means reimplementing business rules.
 *
 * @module storage/types
 */

/** Any value a driver is able to round-trip through JSON. */
export type StorageValue =
  | string
  | number
  | boolean
  | null
  | StorageValue[]
  | { [key: string]: StorageValue };

/**
 * A pluggable persistence backend.
 *
 * Implementations must be safe to call concurrently: the poller and user
 * commands both write, and a driver that interleaves them badly loses data.
 */
export interface StorageDriver {
  /** Human-readable driver name, surfaced in logs and diagnostics. */
  readonly name: string;

  /** Perform any asynchronous setup. Called once before first use. */
  init(): Promise<void>;

  /** Read a value, or `undefined` when the key is absent. */
  get<T extends StorageValue>(key: string): Promise<T | undefined>;

  /** Write a value, replacing any existing entry. */
  set<T extends StorageValue>(key: string, value: T): Promise<void>;

  /** Remove a key. Returns `false` when the key did not exist. */
  delete(key: string): Promise<boolean>;

  /** List every key currently stored. */
  keys(): Promise<string[]>;

  /** Remove every key. Primarily for tests and operator recovery. */
  clear(): Promise<void>;

  /**
   * Flush pending writes and release resources.
   *
   * Must be safe to call more than once, since both graceful shutdown and
   * error paths may invoke it.
   */
  close(): Promise<void>;
}
