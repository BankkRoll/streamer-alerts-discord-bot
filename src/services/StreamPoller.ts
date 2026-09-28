/**
 * Live-status polling.
 *
 * One cycle walks every guild, checks each tracked streamer with bounded
 * concurrency, sends alerts for fresh transitions, and writes all resulting
 * changes back in a single batched update per guild.
 *
 * Behaviours that exist because of specific failure modes:
 *
 * - **Patches, never whole-array writes.** The old implementation read the
 *   streamer array, awaited seconds of HTTP, then wrote the stale array back,
 *   silently discarding any `/streamer add` that landed meanwhile.
 * - **An undetermined check is not an offline check.** A scraper that breaks
 *   returns an error, and an errored check never flips `isLive` to false, so
 *   a site redesign cannot mass-fire "stream ended" transitions.
 * - **Permanent delivery failures pause the streamer** instead of retrying
 *   into a deleted channel forever.
 * - **A cooldown guards re-alerting**, so a platform flapping between live and
 *   offline cannot spam a channel.
 *
 * @module services/StreamPoller
 */

import type { Client } from "discord.js";
import { config } from "../config/index.js";
import { getChecker } from "../platforms/index.js";
import { sendLiveAlert } from "./AlertService.js";
import { streamUrl } from "../ui/theme.js";
import type { LiveStatus, Streamer } from "../types/streamer.js";
import type { GuildRepository } from "../storage/index.js";
import { logger } from "../utils/logger.js";

/** Summary of one completed cycle, used for logging and tests. */
export interface PollCycleResult {
  /** Guilds examined. */
  guilds: number;
  /** Streamers checked. */
  checked: number;
  /** Alerts successfully delivered. */
  alerted: number;
  /** Checks that could not determine a status. */
  failed: number;
  /** Streamers paused due to a permanent delivery failure. */
  paused: number;
}

/**
 * Run `tasks` with a ceiling on how many are in flight at once.
 *
 * Unbounded concurrency would fire every tracked streamer's request
 * simultaneously, which looks like an attack to the platforms being polled.
 *
 * @param tasks - Thunks to execute.
 * @param limit - Maximum simultaneous executions.
 * @returns Every task's resolved value, in completion-safe order.
 */
async function withConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;

      const task = tasks[index];
      if (!task) return;
      results[index] = await task();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );

  return results;
}

/** What one streamer's check concluded, before anything is persisted. */
interface CheckOutcome {
  streamer: Streamer;
  status: LiveStatus;
  /** Fields to merge into the stored record. */
  patch: Partial<Streamer>;
  /** Whether this check represents a new live transition worth alerting. */
  shouldAlert: boolean;
}

/**
 * Polls tracked streamers and dispatches alerts.
 *
 * @example
 * ```ts
 * const poller = new StreamPoller(client, repository);
 * poller.start();
 * // ... later
 * await poller.stop();
 * ```
 */
export class StreamPoller {
  readonly #client: Client;
  readonly #repository: GuildRepository;

  #timer: NodeJS.Timeout | undefined;
  /** Guards against a slow cycle overlapping the next scheduled one. */
  #running = false;
  #stopped = false;
  /** Aborts in-flight platform requests during shutdown. */
  #abortController: AbortController | undefined;

  public constructor(client: Client, repository: GuildRepository) {
    this.#client = client;
    this.#repository = repository;
  }

  /** Begin polling, running the first cycle immediately. */
  public start(): void {
    if (this.#timer) return;
    this.#stopped = false;

    logger.info(
      `Polling every ${Math.round(config.polling.intervalMs / 1000)}s ` +
        `(concurrency ${config.polling.concurrency})`,
    );

    void this.runCycle();

    this.#timer = setInterval(() => {
      void this.runCycle();
    }, config.polling.intervalMs);
  }

  /** Stop polling and abort any in-flight checks. */
  public async stop(): Promise<void> {
    this.#stopped = true;

    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }

    this.#abortController?.abort();

    // Let a cycle already in progress finish its writes rather than tearing
    // storage down underneath it.
    while (this.#running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    logger.info("Stream poller stopped");
  }

  /**
   * Execute one polling cycle.
   *
   * @returns What the cycle did, or zeroes when it was skipped.
   */
  public async runCycle(): Promise<PollCycleResult> {
    const empty: PollCycleResult = {
      guilds: 0,
      checked: 0,
      alerted: 0,
      failed: 0,
      paused: 0,
    };

    if (this.#running) {
      // A cycle outlasting the interval means checks are slow; skipping is
      // better than stacking cycles that compete for the same rate limits.
      logger.warn("Previous poll cycle still running; skipping this one");
      return empty;
    }
    if (this.#stopped) return empty;

    this.#running = true;
    this.#abortController = new AbortController();
    const startedAt = Date.now();

    try {
      const guilds = await this.#repository.getActiveGuilds();
      if (guilds.length === 0) return empty;

      const totals = { ...empty, guilds: guilds.length };

      for (const { guildId, streamers } of guilds) {
        if (this.#stopped) break;

        // A guild the bot was removed from should not be polled; its record
        // is cleaned up by the guildDelete event.
        if (!this.#client.guilds.cache.has(guildId)) {
          logger.debug(`Skipping guild ${guildId}; bot is no longer a member`);
          continue;
        }

        const result = await this.#pollGuild(guildId, streamers);
        totals.checked += result.checked;
        totals.alerted += result.alerted;
        totals.failed += result.failed;
        totals.paused += result.paused;
      }

      logger.debug(
        `Poll cycle finished in ${Date.now() - startedAt}ms: ` +
          `${totals.checked} checked, ${totals.alerted} alerted, ` +
          `${totals.failed} failed, ${totals.paused} paused`,
      );

      return totals;
    } catch (error) {
      // A cycle must never throw into the interval timer; that would kill
      // polling for the life of the process.
      logger.error("Poll cycle failed:", error);
      return empty;
    } finally {
      this.#running = false;
      this.#abortController = undefined;
    }
  }

  /** Poll one guild and persist every resulting change in a single write. */
  async #pollGuild(
    guildId: string,
    streamers: readonly Streamer[],
  ): Promise<Omit<PollCycleResult, "guilds">> {
    const active = streamers.filter((streamer) => streamer.paused !== true);
    if (active.length === 0) {
      return { checked: 0, alerted: 0, failed: 0, paused: 0 };
    }

    const outcomes = await withConcurrency(
      active.map((streamer) => () => this.#checkStreamer(streamer)),
      config.polling.concurrency,
    );

    const patches = new Map<string, Partial<Streamer>>();
    let alerted = 0;
    let failed = 0;
    let paused = 0;

    for (const outcome of outcomes) {
      if (outcome.status.error) failed += 1;

      const patch = { ...outcome.patch };

      if (outcome.shouldAlert) {
        const result = await sendLiveAlert(
          this.#client,
          outcome.streamer,
          outcome.status,
        );

        if (result.ok) {
          alerted += 1;
          patch.lastAlertedAt = new Date().toISOString();
        } else if (result.failure.kind === "permanent") {
          // Pausing stops the bot from retrying a deleted channel forever,
          // and the reason surfaces in /streamer list so the user can fix it.
          patch.paused = true;
          patch.pausedReason = result.failure.reason;
          paused += 1;
          logger.warn(
            `Paused ${outcome.streamer.id} in guild ${guildId}: ${result.failure.reason}`,
          );
        } else {
          logger.debug(
            `Transient alert failure for ${outcome.streamer.id}: ${result.failure.reason}`,
          );
        }
      }

      patches.set(outcome.streamer.id, patch);
    }

    // One lock acquisition and one disk write for the whole guild. Ids removed
    // during the cycle are ignored by the repository rather than resurrected.
    await this.#repository.updateStreamers(guildId, patches);

    return { checked: active.length, alerted, failed, paused };
  }

  /** Check one streamer and decide what should change. */
  async #checkStreamer(streamer: Streamer): Promise<CheckOutcome> {
    const checker = getChecker(streamer.platform);

    let status: LiveStatus;
    try {
      status = await checker(streamer.username, this.#abortController?.signal);
    } catch (error) {
      // Checkers are contracted not to throw, but a bug in one must not take
      // down the cycle for every other streamer.
      logger.error(`Checker for ${streamer.id} threw:`, error);
      status = {
        isLive: false,
        platform: streamer.platform,
        username: streamer.username,
        url: streamUrl(streamer.platform, streamer.username),
        error: "Checker threw an unexpected error",
      };
    }

    logger.platform(streamer.platform, streamer.username, status.isLive);

    // An undetermined check records the failure and changes nothing else.
    // Treating it as "offline" would fire spurious end-of-stream transitions
    // across every tracked streamer the moment a site changes its markup.
    if (status.error) {
      const failureCount = (streamer.failureCount ?? 0) + 1;
      const patch: Partial<Streamer> = { failureCount };

      if (failureCount === config.polling.failureThreshold) {
        logger.warn(
          `${streamer.id} has failed ${failureCount} consecutive checks: ${status.error}`,
        );
      }

      return { streamer, status, patch, shouldAlert: false };
    }

    const patch: Partial<Streamer> = {
      isLive: status.isLive,
      failureCount: 0,
      displayName: status.displayName ?? streamer.displayName,
      profileImage: status.profileImage ?? streamer.profileImage,
      title: status.title,
      viewers: status.viewers,
      followers: status.followers ?? streamer.followers,
      thumbnail: status.thumbnail,
      category: status.category,
      startedAt: status.startedAt,
      verified: status.verified ?? streamer.verified,
    };

    if (status.isLive) {
      patch.lastLiveAt = new Date().toISOString();
    }

    return {
      streamer,
      status,
      patch,
      shouldAlert: this.#shouldAlert(streamer, status),
    };
  }

  /**
   * Decide whether a live status warrants an alert.
   *
   * Requires a genuine offline-to-live transition, and additionally a cooldown
   * since the last alert so a platform flapping within one interval cannot
   * post repeatedly.
   */
  #shouldAlert(streamer: Streamer, status: LiveStatus): boolean {
    if (!status.isLive) return false;
    if (streamer.isLive) return false;

    if (config.polling.alertCooldownMs > 0 && streamer.lastAlertedAt) {
      const lastAlerted = Date.parse(streamer.lastAlertedAt);
      if (
        Number.isFinite(lastAlerted) &&
        Date.now() - lastAlerted < config.polling.alertCooldownMs
      ) {
        logger.debug(`Suppressing repeat alert for ${streamer.id} (cooldown)`);
        return false;
      }
    }

    return true;
  }
}
