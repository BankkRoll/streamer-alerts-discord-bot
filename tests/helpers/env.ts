/**
 * Environment fixtures for modules that validate `process.env` at import time.
 *
 * `src/config/index.ts` runs its validation as a side effect of being imported
 * and throws on bad input. Anything that transitively imports it — the storage
 * repository included — therefore needs a valid environment in place *before*
 * the dynamic `import()` happens.
 *
 * @module tests/helpers/env
 */

/** The smallest environment that lets `src/config/index.ts` import cleanly. */
export const MINIMAL_ENV: Readonly<Record<string, string>> = {
  DISCORD_TOKEN: "test-token",
  CLIENT_ID: "123456789012345678",
};

/**
 * Replace `process.env` with a fresh environment for the duration of a test.
 *
 * Only the keys given are present, plus the handful Node itself relies on, so
 * a stray variable in the developer's real shell cannot change a result.
 *
 * @param overrides - Variables to expose to the module under test.
 * @returns A function restoring the previous environment.
 *
 * @example
 * ```ts
 * const restore = withEnv({ ...MINIMAL_ENV, LOG_LEVEL: "debug" });
 * const { config } = await import("../src/config/index.js");
 * restore();
 * ```
 */
export function withEnv(
  overrides: Readonly<Record<string, string>>,
): () => void {
  const previous = process.env;

  // dotenv is imported by the config module and reads from the filesystem;
  // pointing it at a path that cannot exist keeps a developer's real .env out.
  const next: NodeJS.ProcessEnv = {
    PATH: previous.PATH,
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: "/nonexistent/.env",
    ...overrides,
  };

  process.env = next;
  return (): void => {
    process.env = previous;
  };
}
