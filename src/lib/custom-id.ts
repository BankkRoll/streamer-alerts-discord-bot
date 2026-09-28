/**
 * Custom id encoding for interactive components.
 *
 * Discord caps `custom_id` at **100 characters**. The previous implementation
 * JSON-encoded a whole object into that field, which silently overflowed for
 * ordinary inputs: `{"action":"channel_select","platform":"youtube",
 * "username":"..."}` spends 55 characters on punctuation and keys before the
 * data. A 40-character handle was enough to produce an id Discord rejects.
 *
 * This codec uses positional, delimiter-separated segments instead, and
 * validates the result against the limit so an overflow fails loudly at build
 * time rather than as an opaque 400 from the API.
 *
 * @module lib/custom-id
 */

/** Discord's hard limit on the `custom_id` field. */
export const MAX_CUSTOM_ID_LENGTH = 100;

/**
 * Segment separator.
 *
 * `:` already appears inside streamer ids (`twitch:someone`), so a character
 * that cannot occur in a platform name, handle, or snowflake is used instead.
 */
const SEPARATOR = "|";

/** Actions a component can request. */
export const ACTIONS = [
  "add:platform",
  "add:channel",
  "add:confirm",
  "add:modal",
  "remove:select",
  "remove:confirm",
  "remove:cancel",
  "list:page",
  "list:refresh",
  "manage:streamer",
  "alert:test",
  "help:section",
  "noop",
] as const;

/** A recognised component action. */
export type Action = (typeof ACTIONS)[number];

/** Decoded custom id: an action plus its positional arguments. */
export interface CustomIdData {
  /** What the component should do when activated. */
  action: Action;
  /** Positional arguments, interpreted per action. */
  args: string[];
}

/** Raised when an encoded id would exceed Discord's limit. */
export class CustomIdTooLongError extends Error {
  public constructor(encoded: string) {
    super(
      `Encoded custom id is ${encoded.length} characters, exceeding Discord's ` +
        `limit of ${MAX_CUSTOM_ID_LENGTH}: "${encoded}". Shorten the arguments ` +
        `or store the payload out of band and reference it by a short key.`,
    );
    this.name = "CustomIdTooLongError";
  }
}

/**
 * Encode an action and its arguments into a `custom_id`.
 *
 * @param action - The action this component triggers.
 * @param args - Positional arguments; each is stripped of the separator.
 * @returns An id at most {@link MAX_CUSTOM_ID_LENGTH} characters long.
 * @throws {CustomIdTooLongError} When the result exceeds the limit.
 *
 * @example
 * ```ts
 * encodeCustomId("remove:confirm", ["twitch:someone"]);
 * // "remove:confirm|twitch:someone"
 * ```
 */
export function encodeCustomId(action: Action, args: string[] = []): string {
  // A literal separator inside an argument would shift every later position,
  // so it is removed rather than escaped; no legitimate argument contains one.
  const safe = args.map((arg) => arg.split(SEPARATOR).join(""));
  const encoded = [action, ...safe].join(SEPARATOR);

  if (encoded.length > MAX_CUSTOM_ID_LENGTH) {
    throw new CustomIdTooLongError(encoded);
  }
  return encoded;
}

/**
 * Decode a `custom_id` produced by {@link encodeCustomId}.
 *
 * Ids from an older deployment or another bot reach this function after a
 * restart, so an unrecognised action is `null` rather than an exception.
 *
 * @param customId - Raw id from the interaction.
 * @returns The decoded action and arguments, or `null` when unrecognised.
 *
 * @example
 * ```ts
 * decodeCustomId("list:page|2");
 * // { action: "list:page", args: ["2"] }
 * ```
 */
export function decodeCustomId(customId: string): CustomIdData | null {
  if (customId.length === 0) return null;

  const [action, ...args] = customId.split(SEPARATOR);
  if (action === undefined) return null;
  if (!(ACTIONS as readonly string[]).includes(action)) return null;

  return { action: action as Action, args };
}

/**
 * Parse a positional argument as a non-negative integer.
 *
 * Custom ids survive restarts and can be replayed by a user clicking an old
 * message, so every numeric argument is validated rather than trusted.
 *
 * @param args - Decoded arguments.
 * @param index - Position to read.
 * @param fallback - Value used when the argument is missing or invalid.
 * @returns The parsed integer, or `fallback`.
 */
export function readIntArg(
  args: readonly string[],
  index: number,
  fallback = 0,
): number {
  const raw = args[index];
  if (raw === undefined) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
