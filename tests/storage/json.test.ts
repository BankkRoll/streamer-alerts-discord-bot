/**
 * Durability tests for the JSON file storage driver.
 *
 * The JSON driver is the default backend and the only one whose failure mode
 * is permanent data loss, so this suite spends most of its effort on the
 * unhappy paths: corrupt files, crashes mid-write, and stale temp files left
 * by a process that died.
 *
 * @module tests/storage/json.test
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JsonStorageDriver,
  StorageCorruptionError,
} from "../../src/storage/json.js";
import { describeStorageDriverContract } from "../helpers/driver-contract.js";
import { makeTempDir, removeTempDir } from "../helpers/tempdir.js";

const FILENAME = "guilds.json";

describe("JsonStorageDriver", () => {
  let directory: string;
  let file: string;
  let backup: string;
  let temp: string;

  beforeEach(async () => {
    directory = await makeTempDir();
    file = join(directory, FILENAME);
    backup = `${file}.bak`;
    temp = `${file}.tmp`;
  });

  afterEach(async () => {
    await removeTempDir(directory);
  });

  /** Build a driver over the current temp directory with writes undebounced. */
  function createDriver(
    overrides: Partial<ConstructorParameters<typeof JsonStorageDriver>[0]> = {},
  ): JsonStorageDriver {
    return new JsonStorageDriver({
      directory,
      filename: FILENAME,
      writeDebounceMs: 0,
      ...overrides,
    });
  }

  /** Read the primary data file and parse it as the driver would. */
  async function readStored(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  }

  describe("persistence", () => {
    it("writes data that a fresh driver reads back after restart", async () => {
      const first = createDriver();
      await first.init();
      await first.set("guild:1", { streamers: [{ id: "kick:a" }], version: 1 });
      await first.close();

      const second = createDriver();
      await second.init();
      await expect(second.get("guild:1")).resolves.toEqual({
        streamers: [{ id: "kick:a" }],
        version: 1,
      });
      await second.close();
    });

    it("persists deletions across a restart", async () => {
      const first = createDriver();
      await first.init();
      await first.set("guild:1", { a: 1 });
      await first.set("guild:2", { a: 2 });
      await first.delete("guild:1");
      await first.close();

      const second = createDriver();
      await second.init();
      await expect(second.keys()).resolves.toEqual(["guild:2"]);
      await second.close();
    });

    it("creates the data directory when it does not yet exist", async () => {
      const nested = join(directory, "deeply", "nested");
      const driver = new JsonStorageDriver({
        directory: nested,
        filename: FILENAME,
        writeDebounceMs: 0,
      });

      await driver.init();
      await driver.set("guild:1", { a: 1 });
      await driver.close();

      expect(existsSync(join(nested, FILENAME))).toBe(true);
    });
  });

  describe("debounced writes", () => {
    it("coalesces a burst of writes into a single file write", async () => {
      const driver = createDriver({ writeDebounceMs: 40 });
      await driver.init();

      // A poll cycle updates every streamer in quick succession; the point of
      // debouncing is that the disk sees one write, not one per streamer.
      void driver.set("guild:1", { n: 1 });
      void driver.set("guild:2", { n: 2 });
      void driver.set("guild:3", { n: 3 });

      expect(existsSync(file)).toBe(false);

      await driver.flush();

      expect(Object.keys(await readStored()).sort()).toEqual([
        "guild:1",
        "guild:2",
        "guild:3",
      ]);
      await driver.close();
    });

    it("forces a pending write to disk when flush is called", async () => {
      const driver = createDriver({ writeDebounceMs: 10_000 });
      await driver.init();

      void driver.set("guild:1", { n: 1 });
      expect(existsSync(file)).toBe(false);

      await driver.flush();
      expect(await readStored()).toEqual({ "guild:1": { n: 1 } });

      await driver.close();
    });

    it("eventually writes without an explicit flush once the debounce elapses", async () => {
      const driver = createDriver({ writeDebounceMs: 20 });
      await driver.init();

      await driver.set("guild:1", { n: 1 });

      expect(await readStored()).toEqual({ "guild:1": { n: 1 } });
      await driver.close();
    });

    it("treats flush with nothing pending as a no-op", async () => {
      const driver = createDriver({ writeDebounceMs: 50 });
      await driver.init();

      await expect(driver.flush()).resolves.toBeUndefined();
      expect(existsSync(file)).toBe(false);

      await driver.close();
    });
  });

  describe("atomicity", () => {
    it("leaves valid JSON on disk after close", async () => {
      const driver = createDriver({ writeDebounceMs: 30 });
      await driver.init();

      for (let index = 0; index < 25; index += 1) {
        void driver.set(`guild:${index}`, { index, payload: "x".repeat(500) });
      }
      await driver.close();

      const parsed = await readStored();
      expect(Object.keys(parsed)).toHaveLength(25);
      expect(parsed["guild:24"]).toMatchObject({ index: 24 });
    });

    it("removes the temp file once a write completes", async () => {
      const driver = createDriver();
      await driver.init();
      await driver.set("guild:1", { a: 1 });
      await driver.close();

      // A lingering .tmp after a clean write means the rename never happened.
      expect(existsSync(temp)).toBe(false);
      expect(existsSync(file)).toBe(true);
    });

    it("retains the previous good contents as a backup after a second write", async () => {
      const driver = createDriver();
      await driver.init();
      await driver.set("guild:1", { generation: 1 });
      await driver.set("guild:2", { generation: 2 });
      await driver.close();

      const backupContents = JSON.parse(await readFile(backup, "utf8")) as
        Record<string, unknown>;
      expect(backupContents).toEqual({ "guild:1": { generation: 1 } });
    });
  });

  describe("crash recovery", () => {
    it("recovers entries from the backup when the primary file is garbage", async () => {
      const first = createDriver();
      await first.init();
      await first.set("guild:1", { streamers: [{ id: "kick:a" }] });
      await first.set("guild:2", { streamers: [{ id: "kick:b" }] });
      await first.close();

      // Simulate a torn or truncated primary while the .bak survives.
      await writeFile(file, "{ this is not json", "utf8");

      const onWarning = vi.fn();
      const second = createDriver({ onWarning });
      await second.init();

      // .bak holds the state as of the write before last.
      await expect(second.get("guild:1")).resolves.toEqual({
        streamers: [{ id: "kick:a" }],
      });
      expect(onWarning).toHaveBeenCalledOnce();
      expect(onWarning.mock.calls[0]?.[0]).toMatch(/corrupt/i);

      await second.close();
    });

    it("recovers from the backup when the primary file is missing entirely", async () => {
      const first = createDriver();
      await first.init();
      await first.set("guild:1", { a: 1 });
      await first.set("guild:2", { a: 2 });
      await first.close();

      // A crash between the backup copy and the rename leaves only the .bak.
      const { unlink } = await import("node:fs/promises");
      await unlink(file);

      const onWarning = vi.fn();
      const second = createDriver({ onWarning });
      await second.init();

      await expect(second.get("guild:1")).resolves.toEqual({ a: 1 });
      expect(onWarning).toHaveBeenCalledOnce();
      expect(onWarning.mock.calls[0]?.[0]).toMatch(/missing/i);

      await second.close();
    });

    it("cleans up a stale temp file left behind by a crashed process", async () => {
      const first = createDriver();
      await first.init();
      await first.set("guild:1", { a: 1 });
      await first.close();

      // A process killed mid-write leaves a half-written .tmp; the primary is
      // still the authority, so the temp is simply stale.
      await writeFile(temp, '{"guild:9": {"partial', "utf8");

      const second = createDriver();
      await second.init();

      expect(existsSync(temp)).toBe(false);
      await expect(second.get("guild:1")).resolves.toEqual({ a: 1 });
      await expect(second.get("guild:9")).resolves.toBeUndefined();

      await second.close();
    });
  });

  describe("refusing to start with an empty dataset", () => {
    // THE critical safety property. Starting empty over a corrupt file means
    // the next write replaces recoverable data with `{}` — silent, total,
    // irreversible data loss. Failing loudly leaves the operator a file to fix.
    it("throws StorageCorruptionError when the primary is corrupt and no backup exists", async () => {
      await writeFile(file, "not json at all", "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);
    });

    it("throws rather than starting empty when both primary and backup are corrupt", async () => {
      await writeFile(file, "{ broken", "utf8");
      await writeFile(backup, "also broken", "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);
    });

    it("throws when the primary is missing and the surviving backup is corrupt", async () => {
      await writeFile(backup, "{ broken", "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);
    });

    it("names the offending path and explains the refusal", async () => {
      await writeFile(file, "}}}", "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(
        /Refusing to start with an empty dataset/i,
      );
      await expect(driver.init()).rejects.toThrow(FILENAME);
    });

    it("preserves the corrupt file on disk so the operator can recover it", async () => {
      await writeFile(file, "{ salvageable-ish", "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);

      // Deleting the evidence would defeat the entire point of refusing.
      expect(await readFile(file, "utf8")).toBe("{ salvageable-ish");
    });
  });

  describe("parsing tolerance and strictness", () => {
    it("treats an empty file as an empty dataset rather than corruption", async () => {
      await writeFile(file, "", "utf8");

      const driver = createDriver();
      await expect(driver.init()).resolves.toBeUndefined();
      await expect(driver.keys()).resolves.toEqual([]);
      await driver.close();
    });

    it("treats a whitespace-only file as an empty dataset", async () => {
      await writeFile(file, "   \n\t  \n", "utf8");

      const driver = createDriver();
      await expect(driver.init()).resolves.toBeUndefined();
      await expect(driver.keys()).resolves.toEqual([]);
      await driver.close();
    });

    it("starts empty when neither the file nor a backup exists at all", async () => {
      const driver = createDriver();
      await expect(driver.init()).resolves.toBeUndefined();
      await expect(driver.keys()).resolves.toEqual([]);
      await driver.close();
    });

    it("rejects a top-level JSON array as corruption", async () => {
      // A hand-edit that turns the object into an array would otherwise load
      // as index-keyed nonsense rather than failing.
      await writeFile(file, '[{"guild:1": {}}]', "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);
    });

    it.each([
      ["a string", '"just a string"'],
      ["a number", "42"],
      ["a boolean", "true"],
      ["null", "null"],
    ])("rejects %s at the top level as corruption", async (_label, raw) => {
      await writeFile(file, raw, "utf8");

      const driver = createDriver();
      await expect(driver.init()).rejects.toThrow(StorageCorruptionError);
    });
  });

  describe("lifecycle", () => {
    it("rejects set after close", async () => {
      const driver = createDriver();
      await driver.init();
      await driver.close();

      await expect(driver.set("guild:1", { a: 1 })).rejects.toThrow(/closed/i);
    });

    it("rejects delete and clear after close", async () => {
      const driver = createDriver();
      await driver.init();
      await driver.set("guild:1", { a: 1 });
      await driver.close();

      await expect(driver.delete("guild:1")).rejects.toThrow(/closed/i);
      await expect(driver.clear()).rejects.toThrow(/closed/i);
    });

    it("still serves reads after close, so shutdown paths can inspect state", async () => {
      const driver = createDriver();
      await driver.init();
      await driver.set("guild:1", { a: 1 });
      await driver.close();

      await expect(driver.get("guild:1")).resolves.toEqual({ a: 1 });
      await expect(driver.keys()).resolves.toEqual(["guild:1"]);
    });

    it("flushes pending writes as part of close rather than dropping them", async () => {
      const driver = createDriver({ writeDebounceMs: 10_000 });
      await driver.init();

      void driver.set("guild:1", { a: 1 });
      await driver.close();

      expect(await readStored()).toEqual({ "guild:1": { a: 1 } });
    });
  });

  describe("concurrency", () => {
    // Writes are serialised through a promise chain. If two flushes ever
    // overlapped, the temp file would be written by one and renamed by the
    // other, producing a file that parses but holds a mixture of generations.
    it("does not interleave or lose concurrent writes to the same key", async () => {
      const driver = createDriver({ writeDebounceMs: 5 });
      await driver.init();

      await Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          driver.set("guild:1", { index, marker: `v${index}` }),
        ),
      );
      await driver.close();

      const stored = (await readStored())["guild:1"] as {
        index: number;
        marker: string;
      };
      // Whichever generation won, the two fields must come from the same one.
      expect(stored.marker).toBe(`v${stored.index}`);
    });

    it("persists every key when distinct keys are written concurrently", async () => {
      const driver = createDriver({ writeDebounceMs: 5 });
      await driver.init();

      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          driver.set(`guild:${index}`, { index }),
        ),
      );
      await driver.close();

      const stored = await readStored();
      expect(Object.keys(stored)).toHaveLength(100);
      expect(stored["guild:57"]).toEqual({ index: 57 });
    });

    it("keeps the last write when a set races a concurrent flush", async () => {
      const driver = createDriver({ writeDebounceMs: 25 });
      await driver.init();

      const flushing = driver.flush();
      const writing = driver.set("guild:1", { a: 1 });
      await Promise.all([flushing, writing]);
      await driver.close();

      expect(await readStored()).toEqual({ "guild:1": { a: 1 } });
    });
  });
});

describeStorageDriverContract("JsonStorageDriver", (() => {
  let directory: string | undefined;

  return {
    async create() {
      directory = await makeTempDir();
      return new JsonStorageDriver({
        directory,
        filename: FILENAME,
        writeDebounceMs: 0,
      });
    },
    async cleanup() {
      if (directory) await removeTempDir(directory);
      directory = undefined;
    },
  };
})());
