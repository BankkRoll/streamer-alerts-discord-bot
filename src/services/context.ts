/**
 * Shared runtime services.
 *
 * The repository and cooldown manager are process-wide singletons that need
 * asynchronous setup, so they are created during startup and resolved here
 * rather than imported as module-level state. That keeps tests able to install
 * their own instances and makes the initialisation order explicit.
 *
 * @module services/context
 */

import { CooldownManager } from "../lib/cooldowns.js";
import { createDriver, GuildRepository } from "../storage/index.js";

/** Services available once {@link initialiseContext} has run. */
export interface RuntimeContext {
  /** Persistence for guild state. */
  repository: GuildRepository;
  /** Per-user command throttling. */
  cooldowns: CooldownManager;
}

let context: RuntimeContext | undefined;

/**
 * Create and initialise the runtime services.
 *
 * @param overrides - Replacement services, used by tests.
 * @returns The initialised context.
 *
 * @example
 * ```ts
 * await initialiseContext();
 * const repo = getRepository();
 * ```
 */
export async function initialiseContext(
  overrides: Partial<RuntimeContext> = {},
): Promise<RuntimeContext> {
  const repository =
    overrides.repository ?? new GuildRepository(createDriver());

  if (!overrides.repository) {
    await repository.init();
  }

  context = {
    repository,
    cooldowns: overrides.cooldowns ?? new CooldownManager(),
  };

  return context;
}

/** Return the initialised context, or explain that startup was skipped. */
function requireContext(): RuntimeContext {
  if (!context) {
    throw new Error(
      "Runtime context is not initialised; await initialiseContext() during startup",
    );
  }
  return context;
}

/** The guild repository. */
export function getRepository(): GuildRepository {
  return requireContext().repository;
}

/** The cooldown manager. */
export function getCooldowns(): CooldownManager {
  return requireContext().cooldowns;
}

/**
 * Release the context's resources.
 *
 * Flushes pending writes, so shutdown must await this before exiting.
 */
export async function disposeContext(): Promise<void> {
  if (!context) return;

  context.cooldowns.destroy();
  await context.repository.close();
  context = undefined;
}
