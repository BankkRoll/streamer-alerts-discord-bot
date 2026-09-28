/**
 * Tests for startup command synchronisation.
 *
 * The property that matters most is idempotency: a restart with no command
 * changes must perform a read and no write. Discord enforces a daily quota on
 * command creation, so a sync that always writes would let a crash-looping
 * process exhaust it.
 *
 * @module tests/services/command-sync
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";

type SyncModule = typeof import("../../src/services/CommandSync.js");

let restoreEnv: (() => void) | undefined;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

/** Load the module with a validated environment in place. */
async function loadSync(
  extraEnv: Record<string, string> = {},
): Promise<SyncModule> {
  restoreEnv = withEnv({ ...MINIMAL_ENV, ...extraEnv });
  return import("../../src/services/CommandSync.js");
}

/**
 * Minimal REST double recording what the sync did.
 *
 * @param remote - What Discord should report as already registered.
 */
function fakeRest(remote: unknown[]): {
  client: { get: () => Promise<unknown>; put: (r: unknown, o: unknown) => Promise<unknown> };
  puts: unknown[];
  gets: number;
} {
  const puts: unknown[] = [];
  let gets = 0;

  return {
    puts,
    get gets() {
      return gets;
    },
    client: {
      get: async () => {
        gets += 1;
        return remote;
      },
      put: async (_route: unknown, options: unknown) => {
        puts.push(options);
        return [];
      },
    },
  };
}

describe("syncCommands", () => {
  it("writes nothing when Discord already matches the local registry", async () => {
    const { syncCommands } = await loadSync();
    const { getCommandData } = await import("../../src/commands/index.js");

    // Echo the local payloads back verbatim, standing in for a fresh deploy.
    const rest = fakeRest(getCommandData());
    const result = await syncCommands(rest.client as never);

    expect(result.changed).toBe(false);
    expect(rest.puts).toHaveLength(0);
  });

  it("stays a no-op when Discord omits falsy defaults it never echoes", async () => {
    // Regression: Discord drops `required: false` and an empty `options` array
    // from its responses, while the builders emit both explicitly. Comparing
    // raw payloads therefore reported every command with an optional argument
    // as changed on every boot, producing a write per restart.
    const { syncCommands } = await loadSync();
    const { getCommandData } = await import("../../src/commands/index.js");

    const stripDefaults = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripDefaults);
      if (value === null || typeof value !== "object") return value;

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(
            ([, item]) =>
              item !== false && !(Array.isArray(item) && item.length === 0),
          )
          .map(([key, item]) => [key, stripDefaults(item)]),
      );
    };

    const remote = (getCommandData() as unknown[]).map((command) => ({
      ...(stripDefaults(command) as Record<string, unknown>),
      // Fields Discord adds to every response but the builders never send.
      id: "123456789012345678",
      application_id: "987654321098765432",
      version: "1",
      integration_types: [0],
    }));

    const rest = fakeRest(remote);
    const result = await syncCommands(rest.client as never);

    expect(result.changed).toBe(false);
    expect(rest.puts).toHaveLength(0);
  });

  it("removes commands Discord has that the code no longer defines", async () => {
    const { syncCommands } = await loadSync();
    const { getCommandData } = await import("../../src/commands/index.js");

    const rest = fakeRest([
      ...getCommandData(),
      { name: "obsolete", description: "deleted from the code", type: 1 },
    ]);

    const result = await syncCommands(rest.client as never);

    expect(result.changed).toBe(true);
    expect(result.removed).toContain("obsolete");
    expect(rest.puts).toHaveLength(1);
  });

  it("reports commands missing from Discord as additions", async () => {
    const { syncCommands } = await loadSync();

    // Discord has nothing registered, as on a brand new application.
    const rest = fakeRest([]);
    const result = await syncCommands(rest.client as never);

    expect(result.changed).toBe(true);
    expect(result.added).toEqual(
      expect.arrayContaining(["streamer", "help", "ping"]),
    );
  });

  it("detects a changed description as an update", async () => {
    const { syncCommands } = await loadSync();
    const { getCommandData } = await import("../../src/commands/index.js");

    const remote = (getCommandData() as Record<string, unknown>[]).map(
      (command) =>
        command.name === "ping"
          ? { ...command, description: "something else entirely" }
          : command,
    );

    const rest = fakeRest(remote);
    const result = await syncCommands(rest.client as never);

    expect(result.changed).toBe(true);
    expect(result.updated).toEqual(["ping"]);
  });

  it("targets a guild when GUILD_ID is configured", async () => {
    const { syncCommands } = await loadSync({ GUILD_ID: "424242424242424242" });

    const rest = fakeRest([]);
    const result = await syncCommands(rest.client as never);

    expect(result.scope).toBe("guild");
  });
});
