/**
 * Validation tests for `src/config/index.ts`.
 *
 * The module reads `process.env` and throws during evaluation, so every case
 * installs its environment, resets the module registry, and re-imports. A
 * plain top-level import would freeze one configuration for the whole file.
 *
 * @module tests/config.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MINIMAL_ENV, withEnv } from "./helpers/env.js";

type ConfigModule = typeof import("../src/config/index.js");

let restoreEnv: (() => void) | undefined;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

/**
 * Import a fresh copy of the config module under the given environment.
 *
 * @param env - Variables visible to the module during evaluation.
 * @returns The freshly evaluated module.
 * @throws Whatever the module throws, typically a `ConfigError`.
 *
 * @example
 * ```ts
 * const { config } = await loadConfig({ ...MINIMAL_ENV, LOG_LEVEL: "debug" });
 * ```
 */
async function loadConfig(
  env: Readonly<Record<string, string>>,
): Promise<ConfigModule> {
  restoreEnv?.();
  restoreEnv = withEnv(env);
  vi.resetModules();
  return import("../src/config/index.js");
}

describe("config", () => {
  describe("required variables", () => {
    it("loads successfully with only the required variables set", async () => {
      const { config } = await loadConfig(MINIMAL_ENV);

      expect(config.discord.token).toBe("test-token");
      expect(config.discord.clientId).toBe("123456789012345678");
    });

    it("throws when DISCORD_TOKEN is missing", async () => {
      await expect(loadConfig({ CLIENT_ID: "123" })).rejects.toThrow(
        /DISCORD_TOKEN is required/,
      );
    });

    it("throws when CLIENT_ID is missing", async () => {
      await expect(loadConfig({ DISCORD_TOKEN: "t" })).rejects.toThrow(
        /CLIENT_ID is required/,
      );
    });

    it("treats a blank or whitespace-only value as missing", async () => {
      await expect(
        loadConfig({ DISCORD_TOKEN: "   ", CLIENT_ID: "123" }),
      ).rejects.toThrow(/DISCORD_TOKEN is required/);
    });

    it("trims surrounding whitespace from string values", async () => {
      const { config } = await loadConfig({
        DISCORD_TOKEN: "  padded-token  ",
        CLIENT_ID: "123",
      });

      expect(config.discord.token).toBe("padded-token");
    });

    // An operator fixing a broken deploy should see every problem at once,
    // not discover a second one only after redeploying the fix for the first.
    it("reports every issue in one error instead of stopping at the first", async () => {
      const error = await loadConfig({
        LOG_LEVEL: "verbose",
        POLL_CONCURRENCY: "999",
        LOG_JSON: "maybe",
      }).catch((caught: unknown) => caught as Error);

      expect(error.name).toBe("ConfigError");
      expect(error.message).toContain("DISCORD_TOKEN is required");
      expect(error.message).toContain("CLIENT_ID is required");
      expect(error.message).toContain("LOG_LEVEL must be one of");
      expect(error.message).toContain("POLL_CONCURRENCY must be between");
      expect(error.message).toContain("LOG_JSON must be a boolean");
    });

    it("points the operator at .env.example", async () => {
      await expect(loadConfig({})).rejects.toThrow(/\.env\.example/);
    });
  });

  describe("defaults", () => {
    it("applies every documented default when nothing optional is set", async () => {
      const { config } = await loadConfig(MINIMAL_ENV);

      expect(config.storage).toMatchObject({
        driver: "json",
        path: "./data",
        writeDebounceMs: 250,
      });
      expect(config.storage.connectionString).toBeUndefined();
      expect(config.polling).toMatchObject({
        intervalMs: 60_000,
        requestTimeoutMs: 10_000,
        maxRetries: 2,
        concurrency: 5,
        alertCooldownMs: 1_800_000,
        failureThreshold: 5,
      });
      expect(config.ui).toMatchObject({
        itemsPerPage: 5,
        interactionTimeoutMs: 300_000,
        defaultCooldownMs: 3_000,
      });
      expect(config.limits.maxStreamersPerGuild).toBe(100);
      expect(config.runtime).toMatchObject({
        logLevel: "info",
        logJson: false,
        presenceEnabled: true,
        presenceIntervalMs: 300_000,
      });
    });

    it("leaves an optional variable undefined rather than blank when unset", async () => {
      const { config } = await loadConfig(MINIMAL_ENV);
      expect(config.discord.guildId).toBeUndefined();
    });

    it("reads an optional variable when it is provided", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        GUILD_ID: "987654321",
      });
      expect(config.discord.guildId).toBe("987654321");
    });
  });

  describe("integers", () => {
    it("parses an in-range integer", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        POLL_INTERVAL_MS: "30000",
      });
      expect(config.polling.intervalMs).toBe(30_000);
    });

    it("accepts the inclusive bounds of a range", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        POLL_CONCURRENCY: "1",
        ITEMS_PER_PAGE: "10",
      });

      expect(config.polling.concurrency).toBe(1);
      expect(config.ui.itemsPerPage).toBe(10);
    });

    it("throws when an integer falls below its minimum", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, POLL_INTERVAL_MS: "500" }),
      ).rejects.toThrow(
        /POLL_INTERVAL_MS must be between 10000 and 3600000, received 500/,
      );
    });

    it("throws when an integer exceeds its maximum", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, MAX_STREAMERS_PER_GUILD: "5000" }),
      ).rejects.toThrow(/MAX_STREAMERS_PER_GUILD must be between 1 and 1000/);
    });

    it.each([
      ["a word", "soon"],
      ["a float", "1.5"],
      ["an empty-ish symbol", "-"],
    ])("throws when an integer variable holds %s", async (_label, raw) => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, REQUEST_MAX_RETRIES: raw }),
      ).rejects.toThrow(/REQUEST_MAX_RETRIES must be an integer/);
    });

    it("accepts zero where the range permits it", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        STORAGE_WRITE_DEBOUNCE_MS: "0",
        REQUEST_MAX_RETRIES: "0",
      });

      // Zero is falsy; a naive implementation would silently use the default.
      expect(config.storage.writeDebounceMs).toBe(0);
      expect(config.polling.maxRetries).toBe(0);
    });
  });

  describe("booleans", () => {
    it.each(["1", "true", "TRUE", "yes", "on", " On "])(
      "parses %j as true",
      async (raw) => {
        const { config } = await loadConfig({ ...MINIMAL_ENV, LOG_JSON: raw });
        expect(config.runtime.logJson).toBe(true);
      },
    );

    it.each(["0", "false", "FALSE", "no", "off", " Off "])(
      "parses %j as false",
      async (raw) => {
        const { config } = await loadConfig({
          ...MINIMAL_ENV,
          PRESENCE_ENABLED: raw,
        });
        expect(config.runtime.presenceEnabled).toBe(false);
      },
    );

    it("throws on a value that is neither truthy nor falsy", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, LOG_JSON: "sometimes" }),
      ).rejects.toThrow(/LOG_JSON must be a boolean, received "sometimes"/);
    });
  });

  describe("enums", () => {
    it.each(["json", "memory"])("accepts %j as a storage driver", async (raw) => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        STORAGE_DRIVER: raw,
      });
      expect(config.storage.driver).toBe(raw);
    });

    it("matches an enum value case-insensitively", async () => {
      const { config } = await loadConfig({ ...MINIMAL_ENV, LOG_LEVEL: "DEBUG" });
      expect(config.runtime.logLevel).toBe("debug");
    });

    it("throws on an unknown storage driver and lists the valid options", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, STORAGE_DRIVER: "postgres" }),
      ).rejects.toThrow(
        /STORAGE_DRIVER must be one of json, memory, keyv, received "postgres"/,
      );
    });

    it("throws on an unknown log level", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, LOG_LEVEL: "trace" }),
      ).rejects.toThrow(/LOG_LEVEL must be one of/);
    });

    it("exports the allowed values alongside the config", async () => {
      const { STORAGE_DRIVERS, LOG_LEVELS } = await loadConfig(MINIMAL_ENV);

      expect(STORAGE_DRIVERS).toEqual(["json", "memory", "keyv"]);
      expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error", "silent"]);
    });
  });

  describe("cross-field validation", () => {
    // Selecting keyv without a connection string would fail deep inside the
    // driver at first use; catching it at load turns it into a startup error.
    it("throws when the keyv driver is selected without a connection string", async () => {
      await expect(
        loadConfig({ ...MINIMAL_ENV, STORAGE_DRIVER: "keyv" }),
      ).rejects.toThrow(
        /STORAGE_CONNECTION_STRING is required when STORAGE_DRIVER is "keyv"/,
      );
    });

    it("accepts the keyv driver when a connection string is provided", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        STORAGE_DRIVER: "keyv",
        STORAGE_CONNECTION_STRING: "sqlite://data/bot.sqlite",
      });

      expect(config.storage.driver).toBe("keyv");
      expect(config.storage.connectionString).toBe("sqlite://data/bot.sqlite");
    });

    it("does not require a connection string for the json driver", async () => {
      const { config } = await loadConfig({
        ...MINIMAL_ENV,
        STORAGE_DRIVER: "json",
      });
      expect(config.storage.connectionString).toBeUndefined();
    });

    it("treats a blank connection string as absent for the keyv check", async () => {
      await expect(
        loadConfig({
          ...MINIMAL_ENV,
          STORAGE_DRIVER: "keyv",
          STORAGE_CONNECTION_STRING: "   ",
        }),
      ).rejects.toThrow(/STORAGE_CONNECTION_STRING is required/);
    });
  });
});
