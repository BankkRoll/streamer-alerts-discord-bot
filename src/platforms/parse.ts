/**
 * Coercion helpers for scraped platform data.
 *
 * Everything the checkers read comes from HTML or from JSON blobs embedded in
 * HTML. Those are not APIs: fields disappear, change type, arrive as localised
 * strings, or hold placeholder values like `-1` and `""`. A parser that trusts
 * them produces a `LiveStatus` full of `NaN` viewer counts and broken image
 * links, which then fail silently inside a Discord component.
 *
 * So no scraped value reaches a `LiveStatus` without passing through one of
 * these. Each returns `undefined` rather than throwing, because a missing
 * optional field is never a reason to fail a whole check — only a missing
 * *live/offline signal* is, and that is the checkers' decision to make.
 *
 * @module platforms/parse
 */

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

/**
 * Accept a non-empty trimmed string.
 *
 * @param value - Candidate value of unknown type.
 * @param maxLength - Truncation ceiling; Discord rejects oversized fields.
 * @returns The trimmed string, or `undefined` when it is absent or blank.
 *
 * @example
 * ```ts
 * text("  Just Chatting  "); // "Just Chatting"
 * text("");                  // undefined
 * text(null);                // undefined
 * ```
 */
export function text(value: unknown, maxLength = 1024): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/**
 * Accept a finite, non-negative integer count.
 *
 * Platforms use `-1`, `null`, and occasionally a string for "unknown". A
 * negative or fractional viewer count is always a parse artefact, never real,
 * so it is discarded rather than clamped — showing nothing beats showing a lie.
 *
 * @param value - Candidate value of unknown type.
 * @returns The count, or `undefined` when it is not a usable number.
 *
 * @example
 * ```ts
 * count(1234);   // 1234
 * count("1234"); // 1234
 * count(-1);     // undefined
 * count(NaN);    // undefined
 * ```
 */
export function count(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(/,/g, "").trim())
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.floor(numeric);
}

/**
 * Parse an abbreviated count such as `1.2K`, `3.4M`, or `12,345`.
 *
 * YouTube and Rumble render follower counts for humans, never as raw numbers,
 * so the abbreviation has to be expanded. The result is approximate by nature
 * — `1.2K` could be anything from 1,200 to 1,299 — which is acceptable for a
 * display-only field.
 *
 * @param value - Candidate value, typically a scraped label.
 * @returns The expanded count, or `undefined` when nothing numeric was found.
 *
 * @example
 * ```ts
 * abbreviatedCount("1.2K subscribers"); // 1200
 * ```
 */
export function abbreviatedCount(value: unknown): number | undefined {
  const raw = text(value, 64);
  if (!raw) return undefined;

  const match = /([\d,.]+)\s*([KMB])?/i.exec(raw);
  if (!match?.[1]) return undefined;

  const digits = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(digits) || digits < 0) return undefined;

  const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix ? (multipliers[suffix] ?? 1) : 1;

  return Math.floor(digits * multiplier);
}

/**
 * Accept a strict boolean, treating anything else as unknown.
 *
 * @param value - Candidate value of unknown type.
 * @returns The boolean, or `undefined` when the field was absent or non-boolean.
 */
export function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

// -----------------------------------------------------------------------------
// Structured values
// -----------------------------------------------------------------------------

/**
 * Accept an absolute `http(s)` URL.
 *
 * Validated with `new URL()` rather than a regex because these strings go
 * straight into Discord components, which reject malformed URLs and can fail a
 * whole message over one bad thumbnail. Protocol-relative URLs (`//host/path`)
 * are common in scraped markup and are upgraded to HTTPS; every other scheme —
 * `data:`, `javascript:`, `blob:` — is refused.
 *
 * @param value - Candidate value of unknown type.
 * @returns The normalised absolute URL, or `undefined` when unusable.
 *
 * @example
 * ```ts
 * url("//i.ytimg.com/vi/abc/hq.jpg"); // "https://i.ytimg.com/vi/abc/hq.jpg"
 * url("javascript:alert(1)");         // undefined
 * ```
 */
export function url(value: unknown): string | undefined {
  const raw = text(value, 2048);
  if (!raw) return undefined;

  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Accept a timestamp and render it as an ISO-8601 string.
 *
 * Handles the three shapes these platforms emit: an ISO string, epoch seconds
 * (TikTok), and epoch milliseconds. Seconds and milliseconds are told apart by
 * magnitude, since a seconds value large enough to be mistaken for
 * milliseconds would be in the year 33658.
 *
 * Timestamps outside a sane window are rejected: a `0` start time means "not
 * started", and a far-future date means the field was misread.
 *
 * @param value - Candidate value of unknown type.
 * @returns An ISO-8601 string, or `undefined` when the value is not a sane date.
 *
 * @example
 * ```ts
 * timestamp("2026-01-01T00:00:00Z"); // "2026-01-01T00:00:00.000Z"
 * timestamp(1767225600);             // same instant, from epoch seconds
 * timestamp(0);                      // undefined
 * ```
 */
export function timestamp(value: unknown): string | undefined {
  let ms: number;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    // Below this threshold the value cannot plausibly be milliseconds — 1e12 ms
    // is 2001, and no live stream predates that.
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    const raw = text(value, 64);
    if (!raw) return undefined;

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      ms = numeric < 1e12 ? numeric * 1000 : numeric;
    } else {
      // Kick sends "2026-01-01 12:00:00" with a space and no zone; ISO parsing
      // treats bare datetimes as local time, which is close enough for a
      // "started N minutes ago" display and better than discarding the field.
      ms = Date.parse(raw.includes(" ") ? raw.replace(" ", "T") : raw);
    }
  }

  if (!Number.isFinite(ms)) return undefined;

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;

  const year = date.getUTCFullYear();
  if (year < 2005 || year > new Date().getUTCFullYear() + 1) return undefined;

  return date.toISOString();
}

/**
 * Accept a BCP-47-ish language code.
 *
 * Platforms send `en`, `en-US`, and occasionally a full name like `English`.
 * Only the code forms are kept, so downstream formatting can assume a code.
 *
 * @param value - Candidate value of unknown type.
 * @returns A lowercased language code, or `undefined`.
 */
export function language(value: unknown): string | undefined {
  const raw = text(value, 16);
  if (!raw) return undefined;
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(raw)
    ? raw.toLowerCase()
    : undefined;
}

/**
 * Accept a list of tag strings.
 *
 * Deduplicated case-insensitively and capped, because tag lists are
 * user-authored and occasionally contain dozens of near-identical entries that
 * would overflow a Discord component.
 *
 * @param value - Candidate value, expected to be an array of strings.
 * @param max - Maximum tags to keep.
 * @returns A clean tag list, or `undefined` when none survived.
 *
 * @example
 * ```ts
 * tags(["English", "english", "FPS"]); // ["English", "FPS"]
 * ```
 */
export function tags(value: unknown, max = 10): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    const tag = text(entry, 64);
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(tag);
    if (result.length >= max) break;
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Collapse whitespace in a free-text field such as a bio or title.
 *
 * Scraped bios carry hard line breaks and runs of spaces that render badly in
 * a Discord component.
 *
 * @param value - Candidate value of unknown type.
 * @param maxLength - Truncation ceiling.
 * @returns The collapsed text, or `undefined`.
 */
export function prose(value: unknown, maxLength = 512): string | undefined {
  const raw = text(value, maxLength * 2);
  if (!raw) return undefined;

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength - 1).trimEnd()}…`
    : collapsed;
}

// -----------------------------------------------------------------------------
// Safe traversal
// -----------------------------------------------------------------------------

/**
 * Narrow an unknown value to a plain object for property access.
 *
 * The embedded JSON blobs are deeply nested and reshuffled without notice, so
 * every hop is guarded instead of being asserted through with `any` — a
 * restructured payload then yields `undefined` and a clean "could not
 * determine" error rather than a `TypeError` that kills the poll cycle.
 *
 * @param value - Candidate value of unknown type.
 * @returns The value as an indexable record, or `undefined`.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read a nested property without throwing on a missing intermediate.
 *
 * @param root - Object to traverse.
 * @param path - Property names to follow, in order.
 * @returns The value at `path`, or `undefined` if any hop is missing.
 *
 * @example
 * ```ts
 * dig(payload, "data", "user", "stream", "viewersCount");
 * ```
 */
export function dig(root: unknown, ...path: readonly string[]): unknown {
  let current: unknown = root;

  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }

  return current;
}

/**
 * Narrow an unknown value to an array.
 *
 * @param value - Candidate value of unknown type.
 * @returns The value as an array, or `undefined`.
 */
export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? (value as readonly unknown[]) : undefined;
}

/**
 * Extract a balanced JSON object starting at a marker in an HTML document.
 *
 * A regex cannot do this correctly: `var ytInitialData = ({.*?});` stops at
 * the first `}` followed by `;`, which inside a 1 MB payload containing stream
 * titles and JSON-in-strings is virtually never the real end of the object.
 * The original checkers used exactly that pattern, which is why they degraded
 * to "offline" whenever a title contained a brace.
 *
 * This walks the document tracking brace depth while skipping over string
 * literals and their escapes, so it returns the complete object or nothing.
 *
 * @param html - Full HTML document.
 * @param marker - Literal text immediately preceding the `{`.
 * @returns The JSON substring, or `undefined` when the marker or a balanced
 *   object is absent.
 *
 * @example
 * ```ts
 * const json = extractJsonAfter(html, "var ytInitialData = ");
 * ```
 */
export function extractJsonAfter(
  html: string,
  marker: string,
): string | undefined {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const start = html.indexOf("{", markerIndex + marker.length);
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const char = html[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      // Only meaningful inside a string, but tracking it unconditionally is
      // harmless and avoids a branch.
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  return undefined;
}

/**
 * Parse JSON without throwing.
 *
 * @param json - Candidate JSON text.
 * @returns The parsed value, or `undefined` when parsing failed.
 */
export function parseJsonSafe(json: string | undefined): unknown {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Decode the HTML entities that appear in scraped attribute and text content.
 *
 * Only the five predefined entities plus numeric references are handled;
 * pulling in a full entity table is not worth it for titles and channel names.
 *
 * @param value - Raw scraped text.
 * @returns The decoded text, or `undefined` when empty.
 */
export function decodeEntities(value: unknown): string | undefined {
  const raw = text(value, 4096);
  if (!raw) return undefined;

  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    "#39": "'",
    nbsp: " ",
  };

  return raw.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key in named) return named[key] ?? match;

    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}
