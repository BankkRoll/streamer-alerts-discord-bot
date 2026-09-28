/**
 * Tests for `src/utils/formatters.ts`.
 *
 * Every function here receives text scraped from third-party pages and renders
 * it inside a markdown-aware Discord component. The sanitising tests are
 * therefore security tests: a title that can bold a container, hide text behind
 * a spoiler, or ping `@everyone` is a real defect, not a cosmetic one.
 *
 * @module tests/utils/formatters.test
 */

import { describe, expect, it } from "vitest";
import {
  cleanText,
  discordTimestamp,
  escapeMarkdown,
  formatDuration,
  formatNumber,
  safeText,
  stripMentions,
  truncate,
} from "../../src/utils/formatters.js";
import type { TimestampStyle } from "../../src/utils/formatters.js";

/** U+200B, the zero-width space `stripMentions` uses to defuse `@everyone`. */
const ZERO_WIDTH_SPACE = "\u200B";

describe("formatNumber", () => {
  it("renders values below 1000 in full", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(999)).toBe("999");
  });

  it("abbreviates at the thousand threshold", () => {
    expect(formatNumber(1_000)).toBe("1K");
    expect(formatNumber(1_500)).toBe("1.5K");
    expect(formatNumber(999_999)).toBe("1000K");
  });

  it("abbreviates at the million threshold", () => {
    expect(formatNumber(1_000_000)).toBe("1M");
    expect(formatNumber(2_300_000)).toBe("2.3M");
  });

  it("abbreviates at the billion threshold", () => {
    expect(formatNumber(1_000_000_000)).toBe("1B");
    expect(formatNumber(1_250_000_000)).toBe("1.3B");
  });

  it("drops a trailing .0 rather than rendering 1.0K", () => {
    expect(formatNumber(2_000)).toBe("2K");
    expect(formatNumber(5_000_000)).toBe("5M");
  });

  it("keeps the sign on negative values", () => {
    expect(formatNumber(-1_500)).toBe("-1.5K");
    expect(formatNumber(-42)).toBe("-42");
  });

  it("renders 0 for nullish input", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
  });

  it("renders 0 for non-finite input", () => {
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe("0");
  });

  it("groups large un-abbreviated values with separators", () => {
    // Below the K threshold nothing is abbreviated, so locale grouping is the
    // only formatting applied.
    expect(formatNumber(999)).toBe("999");
  });
});

describe("discordTimestamp", () => {
  /** A fixed instant, so assertions never depend on the clock. */
  const epochMs = 1_767_225_600_000;
  const epochSeconds = 1_767_225_600;

  it("accepts a Date", () => {
    expect(discordTimestamp(new Date(epochMs), "R")).toBe(
      `<t:${epochSeconds}:R>`,
    );
  });

  it("accepts an ISO string", () => {
    expect(discordTimestamp("2026-01-01T00:00:00.000Z", "R")).toBe(
      `<t:${epochSeconds}:R>`,
    );
  });

  it("accepts epoch milliseconds", () => {
    expect(discordTimestamp(epochMs, "R")).toBe(`<t:${epochSeconds}:R>`);
  });

  it("defaults to the relative style", () => {
    expect(discordTimestamp(epochMs)).toBe(`<t:${epochSeconds}:R>`);
  });

  it("renders every supported style", () => {
    const styles: readonly TimestampStyle[] = ["R", "t", "T", "d", "D", "f", "F"];

    for (const style of styles) {
      expect(discordTimestamp(epochMs, style)).toBe(
        `<t:${epochSeconds}:${style}>`,
      );
    }
  });

  it("floors to whole seconds", () => {
    expect(discordTimestamp(epochMs + 999)).toBe(`<t:${epochSeconds}:R>`);
  });

  it('returns "Unknown" for nullish input', () => {
    expect(discordTimestamp(null)).toBe("Unknown");
    expect(discordTimestamp(undefined)).toBe("Unknown");
  });

  it('returns "Unknown" for an unparseable string', () => {
    expect(discordTimestamp("not a date")).toBe("Unknown");
    expect(discordTimestamp("")).toBe("Unknown");
  });

  it('returns "Unknown" for an invalid Date or non-finite number', () => {
    expect(discordTimestamp(new Date("nope"))).toBe("Unknown");
    expect(discordTimestamp(Number.NaN)).toBe("Unknown");
    expect(discordTimestamp(Number.POSITIVE_INFINITY)).toBe("Unknown");
  });
});

describe("truncate", () => {
  it("returns text under the limit unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("returns text at exactly the limit unchanged", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("appends an ellipsis when it shortens the text", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("never exceeds maxLength, ellipsis included", () => {
    for (const limit of [2, 3, 5, 10, 50]) {
      expect(truncate("x".repeat(200), limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it("trims trailing whitespace before the ellipsis", () => {
    expect(truncate("a b cdef", 4)).toBe("a b…");
  });

  it("returns an empty string for a limit of 0 or less", () => {
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("abc", -5)).toBe("");
  });

  it("returns a bare first character at a limit of 1, with no room for an ellipsis", () => {
    expect(truncate("abc", 1)).toBe("a");
  });

  it("handles an empty input", () => {
    expect(truncate("", 10)).toBe("");
  });
});

describe("escapeMarkdown", () => {
  // Without escaping, a scraped title can bold everything after it, hide the
  // rest of a container behind a spoiler, or break the surrounding layout.
  it("escapes emphasis characters so a title cannot style the container", () => {
    expect(escapeMarkdown("**bold**")).toBe("\\*\\*bold\\*\\*");
    expect(escapeMarkdown("_italic_")).toBe("\\_italic\\_");
    expect(escapeMarkdown("~~strike~~")).toBe("\\~\\~strike\\~\\~");
  });

  it("escapes spoiler pipes so a title cannot hide following text", () => {
    expect(escapeMarkdown("||spoiler||")).toBe("\\|\\|spoiler\\|\\|");
  });

  it("escapes code, quote, heading, and list markers", () => {
    expect(escapeMarkdown("`code`")).toBe("\\`code\\`");
    expect(escapeMarkdown("> quote")).toBe("\\> quote");
    expect(escapeMarkdown("# heading")).toBe("\\# heading");
    expect(escapeMarkdown("- item")).toBe("\\- item");
  });

  it("escapes link syntax so a title cannot render as a hyperlink", () => {
    expect(escapeMarkdown("[text](https://evil.example)")).toBe(
      "\\[text\\]\\(https://evil.example\\)",
    );
  });

  it("escapes a backslash so an escape cannot itself be escaped away", () => {
    expect(escapeMarkdown("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeMarkdown("Just a normal title 123")).toBe(
      "Just a normal title 123",
    );
  });
});

describe("stripMentions", () => {
  // @everyone keeps its visible text so the title still reads correctly, but
  // the inserted U+200B stops Discord resolving it into an actual ping.
  it("inserts a zero-width space into @everyone", () => {
    const result = stripMentions("@everyone");

    expect(result).toBe(`@${ZERO_WIDTH_SPACE}everyone`);
    expect(result).toContain("\u200B");
    expect(result).not.toBe("@everyone");
  });

  it("inserts a zero-width space into @here", () => {
    expect(stripMentions("@here")).toBe(`@${ZERO_WIDTH_SPACE}here`);
  });

  it("defuses every occurrence, not just the first", () => {
    const result = stripMentions("@everyone and @everyone");

    expect(result.split("\u200B")).toHaveLength(3);
  });

  it("replaces a user mention outright", () => {
    expect(stripMentions("<@123>")).toBe("[mention]");
    expect(stripMentions("<@!123>")).toBe("[mention]");
  });

  it("replaces a role mention outright", () => {
    expect(stripMentions("<@&456>")).toBe("[mention]");
  });

  it("leaves a non-mention angle-bracket token alone", () => {
    expect(stripMentions("<#123>")).toBe("<#123>");
  });

  it("leaves text containing no mentions unchanged", () => {
    expect(stripMentions("an ordinary title")).toBe("an ordinary title");
  });
});

describe("cleanText", () => {
  it("strips HTML tags", () => {
    expect(cleanText("<b>bold</b> text")).toBe("bold text");
    expect(cleanText("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("strips platform emote codes", () => {
    expect(cleanText("hello [7TV:emote] world")).toBe("hello world");
  });

  it("decodes named HTML entities", () => {
    expect(cleanText("a &amp; b")).toBe("a & b");
    expect(cleanText("&lt;tag&gt;")).toBe("<tag>");
    expect(cleanText("&quot;quoted&quot;")).toBe('"quoted"');
    expect(cleanText("it&#39;s")).toBe("it's");
    expect(cleanText("it&apos;s")).toBe("it's");
  });

  it("decodes numeric HTML entities", () => {
    expect(cleanText("&#65;&#66;&#67;")).toBe("ABC");
  });

  it("drops an out-of-range numeric entity rather than throwing", () => {
    expect(cleanText("&#0;")).toBe("");
    expect(() => cleanText("&#9999999;")).not.toThrow();
  });

  // Control and zero-width characters are the standard way to smuggle
  // invisible formatting past a sanitiser that only looks at visible text.
  it("removes control characters", () => {
    expect(cleanText("a bcd")).toBe("abcd");
  });

  it("removes zero-width and BOM characters", () => {
    expect(cleanText(`a${ZERO_WIDTH_SPACE}b\u200C\u200D\uFEFFc`)).toBe("abc");
  });

  it("collapses runs of spaces", () => {
    expect(cleanText("a    b")).toBe("a b");
  });

  // Regression: the control-character class used to include tab (U+0009)
  // and newline (U+000A), which deleted them before the collapsing rules
  // below could run. Multi-line stream titles and bios were silently joined
  // into one run-on line. The class now excludes both.
  it("collapses runs of tabs and spaces into a single space", () => {
    expect(cleanText("a\t\tb")).toBe("a b");
    expect(cleanText("a \t b")).toBe("a b");
  });

  it("preserves a paragraph break and caps consecutive newlines at two", () => {
    expect(cleanText("a\n\nb")).toBe("a\n\nb");
    expect(cleanText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("normalises CRLF so collapsing sees a single newline form", () => {
    expect(cleanText("a\r\n\r\nb")).toBe("a\n\nb");
  });

  it("trims surrounding whitespace", () => {
    expect(cleanText("   padded   ")).toBe("padded");
  });

  it("returns an empty string when nothing survives cleaning", () => {
    expect(cleanText("<b></b>")).toBe("");
    expect(cleanText("   ")).toBe("");
  });
});

describe("safeText", () => {
  // The composition order matters: cleaning must run before mention stripping
  // and markdown escaping, or an entity-encoded mention survives to render.
  it("cleans, defuses mentions, and escapes markdown together", () => {
    const result = safeText("**@everyone** <b>look</b>");

    expect(result).toContain("\u200B");
    expect(result).toContain("\\*\\*");
    expect(result).not.toContain("<b>");
  });

  it("neutralises an @everyone that would otherwise ping the guild", () => {
    expect(safeText("@everyone")).toBe(`@${ZERO_WIDTH_SPACE}everyone`);
  });

  // cleanText strips `<...>` as an HTML tag before stripMentions can see it,
  // so an explicit user mention disappears entirely rather than becoming the
  // literal "[mention]". Either outcome is safe; this pins which one happens.
  it("removes an explicit user mention entirely", () => {
    expect(safeText("<@123> hello")).toBe("hello");
    expect(safeText("<@&456> hello")).toBe("hello");
  });

  it("truncates to the requested length", () => {
    expect(safeText("x".repeat(100), 10)).toHaveLength(10);
  });

  it("defaults to a 512-character limit", () => {
    expect(safeText("x".repeat(1000)).length).toBe(512);
  });

  it("returns an empty string for input that cleans away to nothing", () => {
    expect(safeText("<b></b>")).toBe("");
  });

  it("leaves benign text readable", () => {
    expect(safeText("Playing Elden Ring")).toBe("Playing Elden Ring");
  });
});

describe("formatDuration", () => {
  it("renders seconds when nothing larger applies", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("renders minutes", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(150_000)).toBe("2m");
  });

  it("renders hours with minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(8_100_000)).toBe("2h 15m");
  });

  it("renders days with hours", () => {
    expect(formatDuration(86_400_000)).toBe("1d");
    expect(formatDuration(90_061_000)).toBe("1d 1h");
  });

  it("shows at most two units, to keep the string short", () => {
    // 1d 1h 1m 1s collapses to the two largest units.
    expect(formatDuration(90_061_000).split(" ")).toHaveLength(2);
  });

  it('renders "0s" for zero', () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it('renders "0s" for negative input', () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(-100_000)).toBe("0s");
  });

  it('renders "0s" for non-finite input', () => {
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe("0s");
  });

  it("renders sub-second input as 0s rather than an empty string", () => {
    expect(formatDuration(500)).toBe("0s");
  });
});
