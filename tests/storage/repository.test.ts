/**
 * Tests for {@link GuildRepository}, the domain layer over the raw drivers.
 *
 * `src/storage/index.ts` transitively imports `src/config/index.ts`, which
 * validates `process.env` at import time and throws on bad input. The module
 * is therefore loaded dynamically after a valid environment is installed.
 *
 * @module tests/storage/repository.test
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";
import { MemoryStorageDriver } from "../../src/storage/memory.js";
import type { StorageDriver, StorageValue } from "../../src/storage/types.js";
import type { Streamer } from "../../src/types/streamer.js";

/** Cap used throughout, kept small so the limit path is cheap to exercise. */
const MAX_STREAMERS = 5;

type StorageModule = typeof import("../../src/storage/index.js");

let storage: StorageModule;
let restoreEnv: () => void;

beforeAll(async () => {
  restoreEnv = withEnv({
    ...MINIMAL_ENV,
    MAX_STREAMERS_PER_GUILD: String(MAX_STREAMERS),
    LOG_LEVEL: "silent",
    STORAGE_DRIVER: "memory",
  });
  storage = await import("../../src/storage/index.js");
});

afterAll(() => {
  restoreEnv();
});

/**
 * Build a streamer with sensible defaults for the fields tests rarely care
 * about, so each test states only what it is actually asserting on.
 *
 * @param overrides - Fields to override on the generated record.
 */
function makeStreamer(overrides: Partial<Streamer> = {}): Streamer {
  const username = overrides.username ?? "alpha";
  const platform = overrides.platform ?? "kick";
  return {
    id: `${platform}:${username.toLowerCase()}`,
    platform,
    username,
    channelId: "channel-1",
    isLive: false,
    addedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A driver wrapper that can be made to stall on `set`.
 *
 * The lost-update race needs a write to be *in flight* while another caller
 * mutates the same guild; a real driver completes far too fast to hit that
 * window reliably, so the delay is made explicit and deterministic.
 */
class ControllableDriver implements StorageDriver {
  public readonly name = "controllable";

  readonly #inner: StorageDriver;
  /** Resolved externally to release a stalled `set`. */
  #gate: Promise<void> | undefined;

  public constructor(inner: StorageDriver = new MemoryStorageDriver()) {
    this.#inner = inner;
  }

  /**
   * Hold the next and all subsequent `set` calls until the returned release
   * function is invoked.
   */
  public block(): () => void {
    let release = (): void => {};
    this.#gate = new Promise<void>((resolve) => {
      release = (): void => {
        this.#gate = undefined;
        resolve();
      };
    });
    return release;
  }

  public async init(): Promise<void> {
    await this.#inner.init();
  }

  public async get<T extends StorageValue>(key: string): Promise<T | undefined> {
    return this.#inner.get<T>(key);
  }

  public async set<T extends StorageValue>(
    key: string,
    value: T,
  ): Promise<void> {
    if (this.#gate) await this.#gate;
    await this.#inner.set(key, value);
  }

  public async delete(key: string): Promise<boolean> {
    return this.#inner.delete(key);
  }

  public async keys(): Promise<string[]> {
    return this.#inner.keys();
  }

  public async clear(): Promise<void> {
    await this.#inner.clear();
  }

  public async close(): Promise<void> {
    await this.#inner.close();
  }
}

describe("GuildRepository", () => {
  let repo: InstanceType<StorageModule["GuildRepository"]>;
  let driver: StorageDriver;

  /** Create a repository over `driver`, defaulting to a plain memory driver. */
  async function createRepo(
    backing: StorageDriver = new MemoryStorageDriver(),
  ): Promise<InstanceType<StorageModule["GuildRepository"]>> {
    driver = backing;
    const created = new storage.GuildRepository(backing);
    await created.init();
    return created;
  }

  afterEach(async () => {
    await repo?.close();
  });

  describe("basic round-trips", () => {
    it("stores an added streamer and reads it back", async () => {
      repo = await createRepo();
      const streamer = makeStreamer();

      const result = await repo.addStreamer("g1", streamer);

      expect(result).toEqual({ ok: true, streamer });
      await expect(repo.getStreamer("g1", streamer.id)).resolves.toEqual(
        streamer,
      );
      await expect(repo.getStreamers("g1")).resolves.toHaveLength(1);
    });

    it("returns empty settings for a guild that was never written", async () => {
      repo = await createRepo();

      await expect(repo.getSettings("unknown")).resolves.toEqual({
        streamers: [],
        version: 1,
      });
      await expect(repo.getStreamers("unknown")).resolves.toEqual([]);
      await expect(
        repo.getStreamer("unknown", "kick:a"),
      ).resolves.toBeUndefined();
    });

    it("removes a streamer and reports whether it was tracked", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      await expect(repo.removeStreamer("g1", "kick:alpha")).resolves.toBe(true);
      await expect(repo.removeStreamer("g1", "kick:alpha")).resolves.toBe(false);
      await expect(repo.getStreamers("g1")).resolves.toEqual([]);
    });

    it("applies a patch to one streamer and reports whether it existed", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      await expect(
        repo.updateStreamer("g1", "kick:alpha", { isLive: true, viewers: 42 }),
      ).resolves.toBe(true);
      await expect(
        repo.updateStreamer("g1", "kick:ghost", { isLive: true }),
      ).resolves.toBe(false);

      const stored = await repo.getStreamer("g1", "kick:alpha");
      expect(stored).toMatchObject({ isLive: true, viewers: 42 });
    });

    it("keeps guilds isolated from one another", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ username: "alpha" }));
      await repo.addStreamer("g2", makeStreamer({ username: "beta" }));

      await expect(repo.getStreamers("g1")).resolves.toHaveLength(1);
      await expect(repo.getStreamer("g2", "kick:alpha")).resolves.toBeUndefined();
    });

    it("deletes an entire guild record", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      await expect(repo.deleteGuild("g1")).resolves.toBe(true);
      await expect(repo.getStreamers("g1")).resolves.toEqual([]);
    });

    it("exposes the underlying driver name for diagnostics", async () => {
      repo = await createRepo();
      expect(repo.driverName).toBe("memory");
    });
  });

  describe("addStreamer guards", () => {
    it("rejects a duplicate id rather than storing it twice", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      await expect(repo.addStreamer("g1", makeStreamer())).resolves.toEqual({
        ok: false,
        reason: "duplicate",
      });
      await expect(repo.getStreamers("g1")).resolves.toHaveLength(1);
    });

    it("rejects an add that would exceed maxStreamersPerGuild", async () => {
      repo = await createRepo();
      for (let index = 0; index < MAX_STREAMERS; index += 1) {
        await repo.addStreamer("g1", makeStreamer({ username: `user${index}` }));
      }

      await expect(
        repo.addStreamer("g1", makeStreamer({ username: "overflow" })),
      ).resolves.toEqual({ ok: false, reason: "limit-reached" });
      await expect(repo.getStreamers("g1")).resolves.toHaveLength(
        MAX_STREAMERS,
      );
    });

    it("checks for a duplicate before the limit, so a re-add at capacity is not mislabelled", async () => {
      repo = await createRepo();
      for (let index = 0; index < MAX_STREAMERS; index += 1) {
        await repo.addStreamer("g1", makeStreamer({ username: `user${index}` }));
      }

      await expect(
        repo.addStreamer("g1", makeStreamer({ username: "user0" })),
      ).resolves.toEqual({ ok: false, reason: "duplicate" });
    });

    it("does not let concurrent adds push a guild past the limit", async () => {
      repo = await createRepo();

      // Without a per-guild lock every one of these would read a length of 0
      // and all would be accepted.
      const results = await Promise.all(
        Array.from({ length: MAX_STREAMERS + 5 }, (_, index) =>
          repo.addStreamer("g1", makeStreamer({ username: `user${index}` })),
        ),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(
        MAX_STREAMERS,
      );
      await expect(repo.getStreamers("g1")).resolves.toHaveLength(
        MAX_STREAMERS,
      );
    });
  });

  describe("lost-update regression", () => {
    // THE bug this layer exists to fix. The poller reads a guild, spends
    // seconds awaiting platform HTTP, then writes back what it read. A user
    // running /add in that window used to be silently erased when the poller's
    // stale snapshot landed. The repository must re-read inside the lock.
    it("keeps a streamer added while a slow updateStreamers is in flight", async () => {
      const controllable = new ControllableDriver();
      repo = await createRepo(controllable);

      await repo.addStreamer("g1", makeStreamer({ username: "existing" }));

      const release = controllable.block();
      const pollerWrite = repo.updateStreamers(
        "g1",
        new Map([["kick:existing", { isLive: true, viewers: 100 }]]),
      );

      // The user command queues behind the stalled poll write.
      const userAdd = repo.addStreamer(
        "g1",
        makeStreamer({ username: "newcomer" }),
      );

      release();
      await expect(pollerWrite).resolves.toBe(1);
      await expect(userAdd).resolves.toMatchObject({ ok: true });

      const streamers = await repo.getStreamers("g1");
      const ids = streamers.map((streamer) => streamer.id).sort();
      expect(ids).toEqual(["kick:existing", "kick:newcomer"]);
      // The poll's own update must also have survived the interleaving.
      expect(
        streamers.find((streamer) => streamer.id === "kick:existing"),
      ).toMatchObject({ isLive: true, viewers: 100 });
    });

    // The mirror case: a streamer the user removed mid-cycle must not be
    // resurrected by the patch the poller was already holding for it.
    it("silently ignores a patch for a streamer removed while the cycle was in flight", async () => {
      const controllable = new ControllableDriver();
      repo = await createRepo(controllable);

      await repo.addStreamer("g1", makeStreamer({ username: "doomed" }));
      await repo.addStreamer("g1", makeStreamer({ username: "keeper" }));

      const release = controllable.block();
      const removal = repo.removeStreamer("g1", "kick:doomed");
      const pollerWrite = repo.updateStreamers(
        "g1",
        new Map([
          ["kick:doomed", { isLive: true }],
          ["kick:keeper", { isLive: true }],
        ]),
      );

      release();
      await expect(removal).resolves.toBe(true);
      // Only the surviving streamer counts as updated.
      await expect(pollerWrite).resolves.toBe(1);

      const streamers = await repo.getStreamers("g1");
      expect(streamers.map((streamer) => streamer.id)).toEqual(["kick:keeper"]);
      expect(streamers[0]).toMatchObject({ isLive: true });
    });

    it("does not resurrect a streamer whose whole guild was deleted mid-cycle", async () => {
      const controllable = new ControllableDriver();
      repo = await createRepo(controllable);

      await repo.addStreamer("g1", makeStreamer());

      const release = controllable.block();
      const deletion = repo.deleteGuild("g1");
      const pollerWrite = repo.updateStreamers(
        "g1",
        new Map([["kick:alpha", { isLive: true }]]),
      );

      release();
      await deletion;
      await expect(pollerWrite).resolves.toBe(0);
      await expect(repo.getStreamers("g1")).resolves.toEqual([]);
    });

    it("serialises interleaved adds and removes without losing either", async () => {
      repo = await createRepo();

      await Promise.all([
        repo.addStreamer("g1", makeStreamer({ username: "a" })),
        repo.addStreamer("g1", makeStreamer({ username: "b" })),
        repo.addStreamer("g1", makeStreamer({ username: "c" })),
      ]);
      await Promise.all([
        repo.removeStreamer("g1", "kick:b"),
        repo.addStreamer("g1", makeStreamer({ username: "d" })),
      ]);

      const ids = (await repo.getStreamers("g1"))
        .map((streamer) => streamer.id)
        .sort();
      expect(ids).toEqual(["kick:a", "kick:c", "kick:d"]);
    });

    it("keeps a mutation chain alive after an earlier mutation throws", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      // A failing poll write must not poison the queue behind it, or every
      // later user command for that guild would hang or fail.
      const exploding = repo.updateStreamers(
        "g1",
        // A Map whose `get` throws stands in for any mutator-side failure.
        new Proxy(new Map([["kick:alpha", { isLive: true }]]), {
          get(target, property) {
            if (property === "get") {
              return (): never => {
                throw new Error("boom");
              };
            }
            return Reflect.get(target, property) as unknown;
          },
        }),
      );

      await expect(exploding).rejects.toThrow("boom");
      await expect(
        repo.addStreamer("g1", makeStreamer({ username: "after" })),
      ).resolves.toMatchObject({ ok: true });
    });
  });

  describe("updateStreamers", () => {
    it("merges patches into existing records instead of replacing them", async () => {
      repo = await createRepo();
      await repo.addStreamer(
        "g1",
        makeStreamer({
          username: "alpha",
          displayName: "Alpha",
          mentionRoleId: "role-1",
        }),
      );

      await repo.updateStreamers(
        "g1",
        new Map([["kick:alpha", { isLive: true, viewers: 7 }]]),
      );

      const stored = await repo.getStreamer("g1", "kick:alpha");
      // Fields the patch never mentioned must survive untouched.
      expect(stored).toMatchObject({
        displayName: "Alpha",
        mentionRoleId: "role-1",
        channelId: "channel-1",
        isLive: true,
        viewers: 7,
      });
    });

    it("refuses to let a patch rewrite the streamer id", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer());

      await repo.updateStreamers(
        "g1",
        new Map([["kick:alpha", { id: "kick:hijacked" }]]),
      );

      await expect(repo.getStreamer("g1", "kick:alpha")).resolves.toBeDefined();
      await expect(
        repo.getStreamer("g1", "kick:hijacked"),
      ).resolves.toBeUndefined();
    });

    it("returns the count of streamers actually updated", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ username: "a" }));
      await repo.addStreamer("g1", makeStreamer({ username: "b" }));

      await expect(
        repo.updateStreamers(
          "g1",
          new Map([
            ["kick:a", { isLive: true }],
            ["kick:b", { isLive: true }],
            ["kick:absent", { isLive: true }],
          ]),
        ),
      ).resolves.toBe(2);
    });

    it("short-circuits an empty patch map without touching storage", async () => {
      repo = await createRepo();
      await expect(repo.updateStreamers("g1", new Map())).resolves.toBe(0);
      await expect(driver.keys()).resolves.toEqual([]);
    });

    it("applies patches to several streamers in one pass", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ username: "a" }));
      await repo.addStreamer("g1", makeStreamer({ username: "b" }));

      await repo.updateStreamers(
        "g1",
        new Map([
          ["kick:a", { isLive: true, title: "Stream A" }],
          ["kick:b", { failureCount: 3 }],
        ]),
      );

      const streamers = await repo.getStreamers("g1");
      expect(streamers.find((s) => s.id === "kick:a")).toMatchObject({
        isLive: true,
        title: "Stream A",
      });
      expect(streamers.find((s) => s.id === "kick:b")).toMatchObject({
        failureCount: 3,
        isLive: false,
      });
    });
  });

  describe("normalise", () => {
    /** Write a raw record straight past the repository's own validation. */
    async function seedRaw(
      backing: StorageDriver,
      guildId: string,
      raw: StorageValue,
    ): Promise<void> {
      await backing.set(`guild:${guildId}`, raw);
    }

    it("drops streamer entries missing required fields", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", {
        streamers: [
          makeStreamer({ username: "good" }) as unknown as StorageValue,
          { id: "kick:nochannel", platform: "kick", username: "x" },
          { platform: "kick", username: "noid", channelId: "c" },
          { id: "kick:noplatform", username: "x", channelId: "c" },
          { id: "kick:nousername", platform: "kick", channelId: "c" },
          null,
          "a bare string",
          42,
        ],
        version: 1,
      });
      repo = await createRepo(backing);

      const streamers = await repo.getStreamers("g1");
      expect(streamers.map((streamer) => streamer.id)).toEqual(["kick:good"]);
    });

    it("tolerates a hand-edited file with the wrong top-level shape", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", ["not", "an", "object"]);
      await seedRaw(backing, "g2", "a string");
      await seedRaw(backing, "g3", null);
      repo = await createRepo(backing);

      for (const guildId of ["g1", "g2", "g3"]) {
        await expect(repo.getSettings(guildId)).resolves.toEqual({
          streamers: [],
          version: 1,
        });
      }
    });

    it("treats a missing or non-array streamers field as empty", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", { version: 1 });
      await seedRaw(backing, "g2", { streamers: "oops", version: 1 });
      repo = await createRepo(backing);

      await expect(repo.getStreamers("g1")).resolves.toEqual([]);
      await expect(repo.getStreamers("g2")).resolves.toEqual([]);
    });

    it("coerces a missing or non-boolean isLive to false", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", {
        streamers: [
          { id: "kick:a", platform: "kick", username: "a", channelId: "c" },
          {
            id: "kick:b",
            platform: "kick",
            username: "b",
            channelId: "c",
            isLive: "yes",
          },
        ],
      });
      repo = await createRepo(backing);

      const streamers = await repo.getStreamers("g1");
      expect(streamers.map((streamer) => streamer.isLive)).toEqual([
        false,
        false,
      ]);
    });

    it("backfills a missing addedAt with the epoch rather than dropping the record", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", {
        streamers: [
          { id: "kick:a", platform: "kick", username: "a", channelId: "c" },
        ],
      });
      repo = await createRepo(backing);

      const [streamer] = await repo.getStreamers("g1");
      expect(streamer?.addedAt).toBe(new Date(0).toISOString());
    });

    it("stamps the current schema version onto legacy records", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await seedRaw(backing, "g1", { streamers: [] });
      repo = await createRepo(backing);

      await expect(repo.getSettings("g1")).resolves.toMatchObject({
        version: 1,
      });
    });
  });

  describe("getActiveGuilds", () => {
    it("returns only guilds tracking at least one streamer", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ username: "a" }));
      await repo.addStreamer("g2", makeStreamer({ username: "b" }));
      await repo.removeStreamer("g2", "kick:b");

      const active = await repo.getActiveGuilds();
      expect(active.map((guild) => guild.guildId)).toEqual(["g1"]);
      expect(active[0]?.streamers).toHaveLength(1);
    });

    it("ignores keys that do not belong to the guild namespace", async () => {
      const backing = new MemoryStorageDriver();
      await backing.init();
      await backing.set("metrics:last-run", { at: 1 });
      repo = await createRepo(backing);
      await repo.addStreamer("g1", makeStreamer());

      const active = await repo.getActiveGuilds();
      expect(active.map((guild) => guild.guildId)).toEqual(["g1"]);
    });

    it("returns an empty list when nothing is stored", async () => {
      repo = await createRepo();
      await expect(repo.getActiveGuilds()).resolves.toEqual([]);
    });

    it("counts streamers across every active guild", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ username: "a" }));
      await repo.addStreamer("g1", makeStreamer({ username: "b" }));
      await repo.addStreamer("g2", makeStreamer({ username: "c" }));

      await expect(repo.getTotalStreamerCount()).resolves.toBe(3);
    });
  });

  describe("removeStreamersForChannel", () => {
    it("removes every streamer pointing at the deleted channel", async () => {
      repo = await createRepo();
      await repo.addStreamer(
        "g1",
        makeStreamer({ username: "a", channelId: "gone" }),
      );
      await repo.addStreamer(
        "g1",
        makeStreamer({ username: "b", channelId: "gone" }),
      );
      await repo.addStreamer(
        "g1",
        makeStreamer({ username: "c", channelId: "kept" }),
      );

      await expect(repo.removeStreamersForChannel("g1", "gone")).resolves.toBe(
        2,
      );

      const streamers = await repo.getStreamers("g1");
      expect(streamers.map((streamer) => streamer.id)).toEqual(["kick:c"]);
    });

    it("reports zero and writes nothing when no streamer uses the channel", async () => {
      repo = await createRepo();
      await repo.addStreamer("g1", makeStreamer({ channelId: "kept" }));

      await expect(
        repo.removeStreamersForChannel("g1", "never-used"),
      ).resolves.toBe(0);
      await expect(repo.getStreamers("g1")).resolves.toHaveLength(1);
    });

    it("only touches the guild it was given", async () => {
      repo = await createRepo();
      await repo.addStreamer(
        "g1",
        makeStreamer({ username: "a", channelId: "shared" }),
      );
      await repo.addStreamer(
        "g2",
        makeStreamer({ username: "b", channelId: "shared" }),
      );

      await repo.removeStreamersForChannel("g1", "shared");

      await expect(repo.getStreamers("g1")).resolves.toEqual([]);
      await expect(repo.getStreamers("g2")).resolves.toHaveLength(1);
    });
  });
});

describe("streamer id helpers", () => {
  it("lowercases the username when building an id", () => {
    expect(storage.createStreamerId("kick", "MixedCase")).toBe(
      "kick:mixedcase",
    );
    expect(storage.createStreamerId("twitch", "ALLCAPS")).toBe(
      "twitch:allcaps",
    );
  });

  it("leaves the platform segment untouched", () => {
    expect(storage.createStreamerId("youtube", "user")).toBe("youtube:user");
  });

  it("round-trips an id built by createStreamerId", () => {
    const id = storage.createStreamerId("rumble", "SomeUser");
    expect(storage.parseStreamerId(id)).toEqual({
      platform: "rumble",
      username: "someuser",
    });
  });

  it("keeps everything after the first colon as the username", () => {
    // YouTube handles and some channel URLs legitimately contain colons.
    expect(storage.parseStreamerId("youtube:a:b:c")).toEqual({
      platform: "youtube",
      username: "a:b:c",
    });
  });

  it.each([
    ["no colon", "kickalpha"],
    ["leading colon", ":alpha"],
    ["trailing colon", "kick:"],
    ["empty string", ""],
    ["colon only", ":"],
  ])("rejects a malformed id with %s", (_label, id) => {
    expect(storage.parseStreamerId(id)).toBeNull();
  });
});

describe("createDriver", () => {
  it("builds the driver named by configuration", () => {
    expect(storage.createDriver("memory").name).toBe("memory");
    expect(storage.createDriver("json").name).toBe("json");
    expect(storage.createDriver("keyv").name).toBe("keyv");
  });

  it("falls back to the json driver for an unrecognised name", () => {
    expect(storage.createDriver("nonsense").name).toBe("json");
  });
});
