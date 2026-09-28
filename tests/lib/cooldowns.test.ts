/**
 * Tests for `src/lib/cooldowns.ts`.
 *
 * The manager reads `config.ui.defaultCooldownMs`, so the module is imported
 * dynamically under a controlled environment. Every instance is constructed
 * with `new CooldownManager(0)` to disable the sweeper interval: a live
 * `setInterval` would otherwise interact with the fake timers these tests
 * install to travel forward in time.
 *
 * @module tests/lib/cooldowns.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";

type CooldownsModule = typeof import("../../src/lib/cooldowns.js");
type Manager = InstanceType<CooldownsModule["CooldownManager"]>;

let CooldownManager: CooldownsModule["CooldownManager"];
let restoreEnv: (() => void) | undefined;

/** One-second window, short enough to read and long enough to step through. */
const WINDOW_MS = 1_000;

beforeEach(async () => {
  restoreEnv = withEnv({ ...MINIMAL_ENV, DEFAULT_COOLDOWN_MS: "3000" });
  vi.resetModules();
  ({ CooldownManager } = await import("../../src/lib/cooldowns.js"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

/** Build a manager with the periodic sweeper disabled. */
function makeManager(): Manager {
  return new CooldownManager(0);
}

describe("CooldownManager.check", () => {
  it("allows the first use of a command", () => {
    const cooldowns = makeManager();

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("blocks a second use inside the window", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    const second = cooldowns.check("streamer", "user-1", WINDOW_MS);
    expect(second.allowed).toBe(false);
  });

  it("still blocks one millisecond before the window closes", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    vi.advanceTimersByTime(WINDOW_MS - 1);

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS).allowed).toBe(false);
  });

  it("allows again once the window has elapsed", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    vi.advanceTimersByTime(WINDOW_MS);

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("restarts the window on each allowed use", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    vi.advanceTimersByTime(WINDOW_MS);
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS).allowed).toBe(false);
  });

  it("falls back to the configured default window when none is given", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1");

    expect(cooldowns.check("streamer", "user-1").allowed).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(cooldowns.check("streamer", "user-1").allowed).toBe(true);
  });
});

describe("CooldownManager retry hints", () => {
  it("reports retryAt as the end of the current window", () => {
    vi.setSystemTime(new Date(1_767_225_600_000));
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    const blocked = cooldowns.check("streamer", "user-1", WINDOW_MS);
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) return;

    expect(blocked.retryAt).toBe(1_767_225_600_000 + WINDOW_MS);
  });

  it("reports retryAtUnix as future unix seconds, not milliseconds", () => {
    vi.setSystemTime(new Date(1_767_225_600_000));
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    const blocked = cooldowns.check("streamer", "user-1", WINDOW_MS);
    if (blocked.allowed) {
      expect.unreachable("second check should have been blocked");
      return;
    }

    expect(blocked.retryAtUnix).toBe(Math.ceil(blocked.retryAt / 1000));
    expect(blocked.retryAtUnix).toBeGreaterThan(Date.now() / 1000);
    // A millisecond value would be ~1e12; unix seconds are ~1.7e9.
    expect(blocked.retryAtUnix).toBeLessThan(1e11);
  });

  it("rounds retryAtUnix up, so a rendered timestamp is never already past", () => {
    vi.setSystemTime(new Date(1_767_225_600_500));
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    const blocked = cooldowns.check("streamer", "user-1", WINDOW_MS);
    if (blocked.allowed) return;

    expect(blocked.retryAtUnix).toBe(1_767_225_602);
  });
});

describe("CooldownManager isolation", () => {
  it("tracks cooldowns per user, so one user cannot block another", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    expect(cooldowns.check("streamer", "user-2", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("tracks cooldowns per command, so one command cannot block another", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    expect(cooldowns.check("help", "user-1", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("keeps separate managers independent", () => {
    const first = makeManager();
    const second = makeManager();
    first.check("streamer", "user-1", WINDOW_MS);

    expect(second.check("streamer", "user-1", WINDOW_MS).allowed).toBe(true);
  });
});

describe("CooldownManager disabled windows", () => {
  it("never blocks when cooldownMs is 0", () => {
    const cooldowns = makeManager();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(cooldowns.check("streamer", "user-1", 0)).toEqual({
        allowed: true,
      });
    }
  });

  it("never blocks when cooldownMs is negative", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", -1);

    expect(cooldowns.check("streamer", "user-1", -1).allowed).toBe(true);
  });

  // A disabled window must not record a use either, or enabling the cooldown
  // later would find a stale timestamp already in place.
  it("records nothing while disabled, so a later enabled check still allows", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", 0);

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS).allowed).toBe(true);
  });
});

describe("CooldownManager.clear", () => {
  // A command that fails before doing any work clears its own cooldown, so the
  // user is not penalised for an error that was not theirs.
  it("releases a blocked user immediately", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    cooldowns.clear("streamer", "user-1");

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("clears only the named user", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    cooldowns.check("streamer", "user-2", WINDOW_MS);
    cooldowns.clear("streamer", "user-1");

    expect(cooldowns.check("streamer", "user-2", WINDOW_MS).allowed).toBe(false);
  });

  it("is a no-op for a user or command with no recorded use", () => {
    const cooldowns = makeManager();

    expect(() => {
      cooldowns.clear("never-run", "user-1");
    }).not.toThrow();
  });
});

describe("CooldownManager.sweep", () => {
  it("drops entries older than the cutoff and reports the count", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    cooldowns.check("streamer", "user-2", WINDOW_MS);
    vi.advanceTimersByTime(3_600_001);

    expect(cooldowns.sweep()).toBe(2);
  });

  it("keeps entries newer than the cutoff", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);

    expect(cooldowns.sweep()).toBe(0);
    expect(cooldowns.check("streamer", "user-1", WINDOW_MS).allowed).toBe(false);
  });

  it("honours a custom max age", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    vi.advanceTimersByTime(5_000);

    expect(cooldowns.sweep(1_000)).toBe(1);
    expect(cooldowns.check("streamer", "user-1", WINDOW_MS).allowed).toBe(true);
  });

  it("returns 0 when there is nothing to sweep", () => {
    expect(makeManager().sweep()).toBe(0);
  });

  it("sweeps across multiple commands", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    cooldowns.check("help", "user-1", WINDOW_MS);
    vi.advanceTimersByTime(3_600_001);

    expect(cooldowns.sweep()).toBe(2);
  });
});

describe("CooldownManager.destroy", () => {
  it("clears recorded usage", () => {
    const cooldowns = makeManager();
    cooldowns.check("streamer", "user-1", WINDOW_MS);
    cooldowns.destroy();

    expect(cooldowns.check("streamer", "user-1", WINDOW_MS)).toEqual({
      allowed: true,
    });
  });

  it("is safe to call more than once", () => {
    const cooldowns = makeManager();
    cooldowns.destroy();

    expect(() => {
      cooldowns.destroy();
    }).not.toThrow();
  });

  it("is safe on a manager that has a live sweeper", () => {
    const cooldowns = new CooldownManager(60_000);

    expect(() => {
      cooldowns.destroy();
    }).not.toThrow();
  });

  it("stops the sweeper so no further timers remain pending", () => {
    const cooldowns = new CooldownManager(60_000);
    cooldowns.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });
});
