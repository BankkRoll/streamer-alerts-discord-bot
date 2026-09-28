/**
 * Tests for the in-memory storage driver.
 *
 * The shared contract suite covers everything the interface promises; this
 * file only adds the behaviour unique to a volatile backend.
 *
 * @module tests/storage/memory.test
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageDriver } from "../../src/storage/memory.js";
import { describeStorageDriverContract } from "../helpers/driver-contract.js";

describeStorageDriverContract("MemoryStorageDriver", {
  create: () => new MemoryStorageDriver(),
});

describe("MemoryStorageDriver specifics", () => {
  it("identifies itself as the memory driver", () => {
    expect(new MemoryStorageDriver().name).toBe("memory");
  });

  it("persists nothing across instances, as a volatile backend must", async () => {
    const first = new MemoryStorageDriver();
    await first.init();
    await first.set("guild:1", { a: 1 });
    await first.close();

    const second = new MemoryStorageDriver();
    await second.init();
    await expect(second.keys()).resolves.toEqual([]);
  });

  it("discards data on close, so a reused instance does not leak state", async () => {
    const driver = new MemoryStorageDriver();
    await driver.init();
    await driver.set("guild:1", { a: 1 });
    await driver.close();

    await expect(driver.keys()).resolves.toEqual([]);
  });

  it("is usable again after close, unlike the file driver", async () => {
    // Nothing is at stake in a volatile store, so this driver deliberately
    // does not implement the file driver's write-after-close guard.
    const driver = new MemoryStorageDriver();
    await driver.init();
    await driver.close();

    await expect(driver.set("guild:1", { a: 1 })).resolves.toBeUndefined();
    await expect(driver.get("guild:1")).resolves.toEqual({ a: 1 });
  });
});
