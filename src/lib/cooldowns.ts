/**
 * Per-user, per-command cooldowns.
 *
 * Several commands reach out to five external sites, so an unthrottled user
 * can generate real load against platforms that did not ask for it. Cooldowns
 * are tracked in memory: they are advisory rate limiting, not a security
 * control, and losing them on restart is harmless.
 *
 * @module lib/cooldowns
 */

import { config } from "../config/index.js";

/** Result of a cooldown check. */
export type CooldownCheck =
  | { allowed: true }
  | {
      allowed: false;
      /** Epoch milliseconds when the command becomes available again. */
      retryAt: number;
      /** Unix seconds, for rendering a Discord relative timestamp. */
      retryAtUnix: number;
    };

/**
 * Tracks when each user last used each command.
 *
 * @example
 * ```ts
 * const cooldowns = new CooldownManager();
 * const check = cooldowns.check("streamer", userId, 5_000);
 * if (!check.allowed) {
 *   return interaction.reply(`Try again <t:${check.retryAtUnix}:R>.`);
 * }
 * ```
 */
export class CooldownManager {
  /** Command name to a map of user id to last-use timestamp. */
  readonly #usage = new Map<string, Map<string, number>>();

  /** Periodic sweep, so abandoned entries cannot grow without bound. */
  #sweeper: NodeJS.Timeout | undefined;

  /**
   * @param sweepIntervalMs - How often expired entries are purged. Set to `0`
   *   to disable the sweeper, which is useful in tests.
   */
  public constructor(sweepIntervalMs = 600_000) {
    if (sweepIntervalMs > 0) {
      this.#sweeper = setInterval(() => this.sweep(), sweepIntervalMs);
      // A cooldown sweep is never a reason to keep the process alive.
      this.#sweeper.unref?.();
    }
  }

  /**
   * Check whether a user may run a command, recording the use when allowed.
   *
   * The check and the record happen together so two interactions arriving in
   * the same tick cannot both pass.
   *
   * @param command - Command name.
   * @param userId - Discord user id.
   * @param cooldownMs - Window for this command; falls back to the configured
   *   default.
   * @returns Whether the call is allowed, and when to retry if not.
   */
  public check(
    command: string,
    userId: string,
    cooldownMs: number = config.ui.defaultCooldownMs,
  ): CooldownCheck {
    if (cooldownMs <= 0) return { allowed: true };

    const now = Date.now();
    let commandUsage = this.#usage.get(command);

    if (!commandUsage) {
      commandUsage = new Map();
      this.#usage.set(command, commandUsage);
    }

    const lastUsed = commandUsage.get(userId);
    if (lastUsed !== undefined) {
      const retryAt = lastUsed + cooldownMs;
      if (now < retryAt) {
        return {
          allowed: false,
          retryAt,
          retryAtUnix: Math.ceil(retryAt / 1000),
        };
      }
    }

    commandUsage.set(userId, now);
    return { allowed: true };
  }

  /**
   * Clear a user's cooldown for one command.
   *
   * Used when a command fails before doing any work, so a user is not
   * penalised for an error that was not theirs.
   *
   * @param command - Command name.
   * @param userId - Discord user id.
   */
  public clear(command: string, userId: string): void {
    this.#usage.get(command)?.delete(userId);
  }

  /**
   * Drop entries old enough that they can no longer block anyone.
   *
   * @param maxAgeMs - Entries older than this are removed.
   * @returns How many entries were dropped.
   */
  public sweep(maxAgeMs = 3_600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [command, users] of this.#usage) {
      for (const [userId, timestamp] of users) {
        if (timestamp < cutoff) {
          users.delete(userId);
          removed += 1;
        }
      }
      if (users.size === 0) this.#usage.delete(command);
    }

    return removed;
  }

  /** Stop the sweeper. Call during shutdown. */
  public destroy(): void {
    if (this.#sweeper) {
      clearInterval(this.#sweeper);
      this.#sweeper = undefined;
    }
    this.#usage.clear();
  }
}
