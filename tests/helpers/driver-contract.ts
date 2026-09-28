/**
 * The behavioural contract every {@link StorageDriver} must satisfy.
 *
 * Driver-specific concerns (file layout, crash recovery, debouncing) belong in
 * that driver's own suite. Everything here is a promise the interface makes
 * regardless of backend, so a new driver inherits the whole suite by calling
 * {@link describeStorageDriverContract} once.
 *
 * @module tests/helpers/driver-contract
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver } from "../../src/storage/types.js";

/** Builds a fresh, uninitialised driver plus its teardown. */
export interface DriverFactory {
  /** Create a new driver instance for one test. */
  create(): Promise<StorageDriver> | StorageDriver;
  /** Release anything `create` allocated, such as a temp directory. */
  cleanup?(): Promise<void> | void;
}

/**
 * Register the shared driver contract suite under `describe(name)`.
 *
 * @param name - Label for the suite, normally the driver's class name.
 * @param factory - Hooks producing and disposing of a driver per test.
 *
 * @example
 * ```ts
 * describeStorageDriverContract("MemoryStorageDriver", {
 *   create: () => new MemoryStorageDriver(),
 * });
 * ```
 */
export function describeStorageDriverContract(
  name: string,
  factory: DriverFactory,
): void {
  describe(`${name} (storage driver contract)`, () => {
    let driver: StorageDriver;

    beforeEach(async () => {
      driver = await factory.create();
      await driver.init();
    });

    afterEach(async () => {
      await driver.close().catch((): void => {});
      await factory.cleanup?.();
    });

    it("round-trips a value through set and get", async () => {
      await driver.set("guild:1", { streamers: [], version: 1 });
      await expect(driver.get("guild:1")).resolves.toEqual({
        streamers: [],
        version: 1,
      });
    });

    it("returns undefined for a key that was never written", async () => {
      await expect(driver.get("guild:missing")).resolves.toBeUndefined();
    });

    it("replaces the previous value when a key is set twice", async () => {
      await driver.set("guild:1", { count: 1 });
      await driver.set("guild:1", { count: 2 });
      await expect(driver.get("guild:1")).resolves.toEqual({ count: 2 });
    });

    it("reports whether delete actually removed something", async () => {
      await driver.set("guild:1", { a: 1 });
      await expect(driver.delete("guild:1")).resolves.toBe(true);
      await expect(driver.delete("guild:1")).resolves.toBe(false);
      await expect(driver.get("guild:1")).resolves.toBeUndefined();
    });

    it("lists exactly the keys currently stored", async () => {
      await driver.set("guild:1", { a: 1 });
      await driver.set("guild:2", { a: 2 });
      await driver.delete("guild:1");

      await expect(driver.keys()).resolves.toEqual(["guild:2"]);
    });

    it("removes every key on clear", async () => {
      await driver.set("guild:1", { a: 1 });
      await driver.set("guild:2", { a: 2 });
      await driver.clear();

      await expect(driver.keys()).resolves.toEqual([]);
      await expect(driver.get("guild:1")).resolves.toBeUndefined();
    });

    it("stores nested structures without flattening or losing them", async () => {
      const value = {
        streamers: [
          { id: "kick:a", tags: ["x", "y"], meta: { nested: { deep: true } } },
        ],
        version: 1,
      };
      await driver.set("guild:1", value);
      await expect(driver.get("guild:1")).resolves.toEqual(value);
    });

    it("round-trips scalar and null values, not just objects", async () => {
      await driver.set("n", 42);
      await driver.set("s", "hello");
      await driver.set("b", false);
      await driver.set("nil", null);

      await expect(driver.get("n")).resolves.toBe(42);
      await expect(driver.get("s")).resolves.toBe("hello");
      // `false` must survive as a value, not collapse into "absent".
      await expect(driver.get("b")).resolves.toBe(false);
      await expect(driver.get("nil")).resolves.toBeNull();
    });

    // REGRESSION: `get` used to hand back the live cached object, so a caller
    // that mutated the result silently changed persisted state — and a later
    // unrelated write flushed that mutation to disk.
    it("returns a copy from get, so mutating the result cannot change stored state", async () => {
      await driver.set("guild:1", { streamers: [{ id: "kick:a" }] });

      const first = await driver.get<{ streamers: { id: string }[] }>(
        "guild:1",
      );
      expect(first).toBeDefined();
      first?.streamers.push({ id: "kick:injected" });
      if (first) first.streamers[0] = { id: "kick:mutated" };

      const second = await driver.get<{ streamers: { id: string }[] }>(
        "guild:1",
      );
      expect(second?.streamers).toEqual([{ id: "kick:a" }]);
    });

    // The mirror of the copy-on-read rule: the caller keeps a reference to the
    // object it passed to `set`, and mutating it afterwards must not reach in.
    it("copies on write, so mutating the argument after set cannot change stored state", async () => {
      const value: { streamers: { id: string }[] } = {
        streamers: [{ id: "kick:a" }],
      };
      await driver.set("guild:1", value);
      value.streamers.push({ id: "kick:injected" });

      const stored = await driver.get<{ streamers: { id: string }[] }>(
        "guild:1",
      );
      expect(stored?.streamers).toEqual([{ id: "kick:a" }]);
    });

    it("returns independent copies to two readers of the same key", async () => {
      await driver.set("guild:1", { streamers: [{ id: "kick:a" }] });

      const a = await driver.get<{ streamers: { id: string }[] }>(
        "guild:1",
      );
      const b = await driver.get<{ streamers: { id: string }[] }>(
        "guild:1",
      );

      expect(a).not.toBe(b);
      a?.streamers.push({ id: "kick:b" });
      expect(b?.streamers).toHaveLength(1);
    });

    it("is safe to close more than once", async () => {
      await driver.set("guild:1", { a: 1 });
      await expect(driver.close()).resolves.toBeUndefined();
      await expect(driver.close()).resolves.toBeUndefined();
    });

    it("keeps every write when many keys are set concurrently", async () => {
      const keys = Array.from({ length: 50 }, (_, index) => `guild:${index}`);
      await Promise.all(keys.map((key, index) => driver.set(key, { index })));

      const stored = await driver.keys();
      expect(stored.sort()).toEqual([...keys].sort());
    });

    // Last writer wins is the contract; what must never happen is a lost or
    // torn intermediate state where the key ends up holding something nobody
    // wrote, or nothing at all.
    it("does not lose or tear concurrent writes to the same key", async () => {
      const writes = Array.from({ length: 100 }, (_, index) =>
        driver.set("guild:1", { index }),
      );
      await Promise.all(writes);

      const stored = await driver.get<{ index: number }>("guild:1");
      expect(stored).toBeDefined();
      expect(stored?.index).toBeGreaterThanOrEqual(0);
      expect(stored?.index).toBeLessThan(100);
      await expect(driver.keys()).resolves.toEqual(["guild:1"]);
    });
  });
}
