/**
 * Minimal levelled logger.
 *
 * Deliberately dependency-free: the bot's logging needs are a handful of
 * levels and optional JSON output, which is not worth a package. Output goes
 * to stdout for informational lines and stderr for warnings and errors, so
 * process supervisors can route them separately.
 *
 * @module utils/logger
 */

import { config } from "../config/index.js";
import type { LogLevel } from "../config/index.js";

/** Severity ordering used to decide what reaches the output. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** ANSI colours, applied only when stdout is an interactive terminal. */
const COLOURS = {
  reset: "[0m",
  dim: "[2m",
  red: "[31m",
  yellow: "[33m",
  blue: "[34m",
  magenta: "[35m",
  cyan: "[36m",
} as const;

/** Colour is noise in a log aggregator, so only use it for a real terminal. */
const useColour = process.stdout.isTTY && !config.runtime.logJson;

const threshold = LEVEL_WEIGHT[config.runtime.logLevel];

/** Wrap text in an ANSI colour when colour output is enabled. */
function paint(colour: keyof typeof COLOURS, text: string): string {
  return useColour ? `${COLOURS[colour]}${text}${COLOURS.reset}` : text;
}

/**
 * Reduce an unknown thrown value to something worth printing.
 *
 * `catch` gives `unknown`, and printing a bare object loses the stack, so
 * errors are unwrapped explicitly.
 */
function formatArgument(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    // Circular structures and BigInt both defeat JSON.stringify.
    return String(value);
  }
}

/** Emit one line at `level`, honouring the configured threshold and format. */
function emit(level: Exclude<LogLevel, "silent">, args: unknown[]): void {
  if (LEVEL_WEIGHT[level] < threshold) return;

  const timestamp = new Date().toISOString();
  const message = args.map(formatArgument).join(" ");
  const stream = LEVEL_WEIGHT[level] >= LEVEL_WEIGHT.warn ? process.stderr : process.stdout;

  if (config.runtime.logJson) {
    stream.write(`${JSON.stringify({ timestamp, level, message })}\n`);
    return;
  }

  const colour = (
    { debug: "dim", info: "blue", warn: "yellow", error: "red" } as const
  )[level];

  stream.write(
    `${paint("dim", timestamp)} ${paint(colour, level.toUpperCase().padEnd(5))} ${message}\n`,
  );
}

/**
 * Application logger.
 *
 * @example
 * ```ts
 * logger.info("Bot ready");
 * logger.error("Failed to send alert:", error);
 * ```
 */
export const logger = {
  /** Verbose detail, hidden unless `LOG_LEVEL=debug`. */
  debug: (...args: unknown[]): void => { emit("debug", args); },
  /** Normal operational messages. */
  info: (...args: unknown[]): void => { emit("info", args); },
  /** Recoverable problems worth an operator's attention. */
  warn: (...args: unknown[]): void => { emit("warn", args); },
  /** Failures. */
  error: (...args: unknown[]): void => { emit("error", args); },

  /**
   * Log the outcome of one platform check.
   *
   * @param platform - Platform that was polled.
   * @param username - Handle that was checked.
   * @param isLive - Whether the streamer was found live.
   */
  platform: (platform: string, username: string, isLive: boolean): void => {
    if (LEVEL_WEIGHT.debug < threshold) return;
    const state = isLive ? paint("magenta", "LIVE") : paint("dim", "offline");
    emit("debug", [`${paint("cyan", platform)} ${username} ${state}`]);
  },
} as const;
