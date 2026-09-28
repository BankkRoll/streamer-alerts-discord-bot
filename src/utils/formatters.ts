/**
 * Text formatting helpers for user-facing output.
 *
 * Everything here defends against untrusted input: stream titles, categories,
 * and biographies are scraped from third-party pages and are rendered inside
 * markdown-aware components, so they are sanitised rather than trusted.
 *
 * @module utils/formatters
 */

/** Discord timestamp rendering styles. */
export type TimestampStyle = "R" | "t" | "T" | "d" | "D" | "f" | "F";

/**
 * Abbreviate a count for display.
 *
 * @param value - Number to format; nullish and non-finite values render as `0`.
 * @returns A compact representation such as `1.5K` or `2.3M`.
 *
 * @example
 * ```ts
 * formatNumber(1500);     // "1.5K"
 * formatNumber(2_300_000) // "2.3M"
 * ```
 */
export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "0";
  }

  const absolute = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ] as const;

  for (const { threshold, suffix } of units) {
    if (absolute >= threshold) {
      const scaled = (value / threshold).toFixed(1).replace(/\.0$/, "");
      return `${scaled}${suffix}`;
    }
  }

  return Math.trunc(value).toLocaleString("en-US");
}

/**
 * Render a date as a Discord timestamp, which localises per viewer.
 *
 * @param date - Date, ISO string, or epoch milliseconds.
 * @param style - Discord timestamp style; defaults to relative.
 * @returns A `<t:…>` token, or `Unknown` when the input is unparseable.
 *
 * @example
 * ```ts
 * discordTimestamp("2026-01-01T00:00:00Z", "R"); // "<t:1767225600:R>"
 * ```
 */
export function discordTimestamp(
  date: Date | string | number | undefined | null,
  style: TimestampStyle = "R",
): string {
  if (date === undefined || date === null) return "Unknown";

  const milliseconds =
    date instanceof Date
      ? date.getTime()
      : typeof date === "number"
        ? date
        : Date.parse(date);

  if (!Number.isFinite(milliseconds)) return "Unknown";

  return `<t:${Math.floor(milliseconds / 1000)}:${style}>`;
}

/**
 * Shorten text to fit a limit, appending an ellipsis when truncated.
 *
 * @param value - Text to shorten.
 * @param maxLength - Maximum length of the result, including the ellipsis.
 * @returns Text no longer than `maxLength`.
 */
export function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);

  // A single-character ellipsis keeps more of the original than "...".
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Markdown control characters that alter rendering when left unescaped. */
const MARKDOWN_SPECIALS = /([\\*_~`>|#\-[\]()])/g;

/**
 * Escape markdown so scraped text renders literally.
 *
 * Stream titles routinely contain `*`, `_`, and `|`. Without escaping, a title
 * can bold the rest of a component, hide text behind a spoiler, or break the
 * surrounding layout.
 *
 * @param value - Untrusted text.
 * @returns The same text with markdown syntax neutralised.
 *
 * @example
 * ```ts
 * escapeMarkdown("read **this**"); // "read \\*\\*this\\*\\*"
 * ```
 */
export function escapeMarkdown(value: string): string {
  return value.replace(MARKDOWN_SPECIALS, "\\$1");
}

/**
 * Zero-width space inserted to break mention tokens.
 *
 * Written as an escape rather than a literal so it is visible in review and
 * cannot be deleted by accident.
 */
const ZERO_WIDTH_SPACE = "​";

/**
 * Strip mention syntax that would ping a user, role, or `@everyone`.
 *
 * `@everyone` keeps its visible text but gains a zero-width space, which stops
 * Discord resolving it while leaving the title looking untouched. Explicit
 * user and role mentions are replaced outright, since they carry no meaning
 * once removed from their original context.
 *
 * @param value - Untrusted text.
 * @returns Text that cannot notify anyone.
 */
export function stripMentions(value: string): string {
  return value
    .replace(/@(everyone|here)/g, `@${ZERO_WIDTH_SPACE}$1`)
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

/** Common HTML entities appearing in scraped titles and descriptions. */
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Normalise scraped text into something safe to render.
 *
 * Applied to every field that originates from a third-party page: strips HTML
 * tags and emote codes, decodes entities, removes control characters, and
 * collapses runaway whitespace.
 *
 * @param value - Raw scraped text.
 * @returns Cleaned text, or an empty string when nothing survives.
 */
export function cleanText(value: string): string {
  return (
    value
      // Emote codes some platforms inline into titles.
      .replace(/\[7TV:[^\]]+\]/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(
        /&(?:amp|lt|gt|quot|apos|nbsp|#39);/g,
        (entity) => HTML_ENTITIES[entity] ?? entity,
      )
      // Numeric entities, bounded to valid code points.
      .replace(/&#(\d{1,7});/g, (_match, code: string) => {
        const point = Number.parseInt(code, 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
      })
      // Control characters plus zero-width and BOM characters, which are used
      // to smuggle invisible formatting past a naive sanitiser.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "")
      // Normalise CRLF so the newline collapsing below sees a single form.
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Prepare untrusted text for rendering inside a component.
 *
 * Combines cleaning, mention stripping, markdown escaping, and truncation in
 * the order that keeps the result both safe and within its limit.
 *
 * @param value - Untrusted text, typically scraped.
 * @param maxLength - Maximum rendered length.
 * @returns Text safe to place in a Text Display.
 *
 * @example
 * ```ts
 * safeText("**@everyone** look", 40);
 * // Renders as literal text; the inserted U+200B stops the ping.
 * ```
 */
export function safeText(value: string, maxLength = 512): string {
  return truncate(escapeMarkdown(stripMentions(cleanText(value))), maxLength);
}

/**
 * Render a duration in milliseconds as a compact human string.
 *
 * @param milliseconds - Duration to format.
 * @returns A string such as `2h 15m`, or `0s` for non-positive input.
 *
 * @example
 * ```ts
 * formatDuration(8_100_000); // "2h 15m"
 * ```
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0s";

  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  // Only show seconds when nothing larger applies, to keep the string short.
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.slice(0, 2).join(" ");
}
