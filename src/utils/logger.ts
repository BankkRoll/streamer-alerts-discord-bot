/**
 * Log levels
 */
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

/**
 * Get current timestamp string
 */
function getTimestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Format log message with timestamp and level
 */
function formatMessage(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): string {
  const timestamp = `${colors.dim}[${getTimestamp()}]${colors.reset}`;
  const levelColors: Record<LogLevel, string> = {
    debug: colors.cyan,
    info: colors.green,
    warn: colors.yellow,
    error: colors.red,
  };
  const levelStr = `${levelColors[level]}[${level.toUpperCase()}]${colors.reset}`;

  const formattedArgs =
    args.length > 0
      ? " " +
        args
          .map((arg) =>
            typeof arg === "object"
              ? JSON.stringify(arg, null, 2)
              : String(arg),
          )
          .join(" ")
      : "";

  return `${timestamp} ${levelStr} ${message}${formattedArgs}`;
}

/**
 * Logger utility
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(formatMessage("debug", message, ...args));
    }
  },

  info(message: string, ...args: unknown[]): void {
    console.log(formatMessage("info", message, ...args));
  },

  warn(message: string, ...args: unknown[]): void {
    console.warn(formatMessage("warn", message, ...args));
  },

  error(message: string, ...args: unknown[]): void {
    console.error(formatMessage("error", message, ...args));
  },

  /**
   * Log a platform check result
   */
  platform(platform: string, username: string, isLive: boolean): void {
    const status = isLive
      ? `${colors.green}LIVE${colors.reset}`
      : `${colors.dim}offline${colors.reset}`;
    this.debug(`[${platform}] ${username}: ${status}`);
  },

  /**
   * Log a command execution
   */
  command(name: string, user: string, guild: string): void {
    this.info(`Command /${name} executed by ${user} in ${guild}`);
  },
};
