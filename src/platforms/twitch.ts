/**
 * Twitch live-status checker.
 *
 * Uses Twitch's public GraphQL gateway with the web client's own Client-ID.
 * This needs no API key and no OAuth, which is the whole reason the bot can
 * run unconfigured — but it is an internal endpoint, so it can change without
 * notice and is rate limited per IP.
 *
 * Twitch's GraphQL returns HTTP 200 for a missing channel, with `data.user`
 * set to `null`. Distinguishing that from a transport failure matters: one is
 * a permanent "no such channel", the other is worth retrying.
 *
 * @module platforms/twitch
 */

import { fetchJson } from "./http.js";
import { failed, parseError, ParseFailure, requestError } from "./errors.js";
import { encodeHandle, validateUsername } from "./validation.js";
import {
  asArray,
  asRecord,
  count,
  dig,
  flag,
  language,
  prose,
  text,
  timestamp,
  url as parseUrl,
} from "./parse.js";
import type { LiveStatus } from "../types/streamer.js";
import { logger } from "../utils/logger.js";

/** Twitch's public GraphQL endpoint. */
const GQL_ENDPOINT = "https://gql.twitch.tv/gql";

/**
 * Client-ID published by Twitch's own web player.
 *
 * Well-known and used by every unauthenticated Twitch scraper; it grants only
 * the read access an anonymous browser already has.
 */
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

/**
 * Query for the channel and, if broadcasting, its stream.
 *
 * Image sizes are requested explicitly because the unsized fields return
 * template URLs containing `{width}` placeholders, which are not valid URLs
 * and would be discarded by validation.
 */
const USER_STREAM_QUERY = `
  query GetUserStream($login: String!) {
    user(login: $login) {
      id
      login
      displayName
      description
      profileImageURL(width: 300)
      followers { totalCount }
      roles { isPartner isAffiliate }
      stream {
        id
        title
        type
        viewersCount
        createdAt
        language
        previewImageURL(width: 640, height: 360)
        game { id name displayName boxArtURL(width: 144, height: 192) }
        freeformTags { name }
      }
    }
  }
`;

/**
 * Check whether a Twitch channel is currently broadcasting.
 *
 * Never throws. A null `user` is reported as a missing channel; a transport
 * failure or an unrecognised response shape sets `error` rather than claiming
 * the channel is offline.
 *
 * @param username - Twitch login, as entered by the user.
 * @param signal - Optional cancellation signal, propagated to the request.
 * @returns The channel's live status.
 *
 * @example
 * ```ts
 * const status = await checkTwitchLive("pokimane");
 * status.isLive; // true while broadcasting
 * ```
 */
export async function checkTwitchLive(
  username: string,
  signal?: AbortSignal,
): Promise<LiveStatus> {
  const validation = validateUsername("twitch", username);
  if (!validation.ok) {
    return failed(
      { platform: "twitch", username, url: "https://twitch.tv/" },
      validation.reason,
    );
  }

  const login = validation.normalised;
  const channelUrl = `https://twitch.tv/${encodeHandle(login)}`;
  const base = { platform: "twitch", username: login, url: channelUrl } as const;

  let payload: unknown;
  try {
    const response = await fetchJson<unknown>(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: USER_STREAM_QUERY,
        variables: { login },
      }),
      signal,
    });
    payload = response.data;
  } catch (error) {
    logger.debug(`[twitch] request failed for ${login}: ${String(error)}`);
    return failed(base, requestError("twitch", error));
  }

  // GraphQL reports failures in the body at HTTP 200, so errors have to be read
  // out of the payload rather than inferred from the status.
  const errors = asArray(dig(payload, "errors"));
  if (errors && errors.length > 0) {
    const first = text(dig(errors[0], "message"), 256) ?? "unknown error";
    return failed(base, `Twitch GraphQL rejected the query: ${first}`);
  }

  // `data` present with `user: null` is the documented "no such login" answer;
  // `data` absent entirely means the response shape changed.
  const data = asRecord(dig(payload, "data"));
  if (!data) {
    return failed(
      base,
      parseError("twitch", ParseFailure.SHAPE_CHANGED, "missing data object"),
    );
  }

  const user = asRecord(data.user);
  if (!user) {
    return failed(base, `No Twitch channel named "${login}" exists.`);
  }

  const profile = {
    displayName: text(user.displayName, 64),
    followers: count(dig(user, "followers", "totalCount")),
    profileImage: parseUrl(user.profileImageURL),
    bio: prose(user.description),
    // Twitch has no "verified" concept; partnership is the closest equivalent
    // and is what the purple check in the UI actually represents.
    verified: flag(dig(user, "roles", "isPartner")) ?? false,
  };

  const stream = asRecord(user.stream);

  // A null stream is Twitch's explicit offline signal.
  if (!stream) {
    return { ...base, ...profile, isLive: false };
  }

  // `type` distinguishes a live broadcast from a rerun/premiere, which should
  // not trigger a "went live" alert.
  const streamType = text(stream.type, 32);
  if (streamType !== "live") {
    return { ...base, ...profile, isLive: false };
  }

  return {
    ...base,
    ...profile,
    isLive: true,
    username: text(user.login, 32) ?? login,
    title: prose(stream.title, 256),
    viewers: count(stream.viewersCount),
    thumbnail: parseUrl(stream.previewImageURL),
    startedAt: timestamp(stream.createdAt),
    category:
      text(dig(stream, "game", "displayName"), 64) ??
      text(dig(stream, "game", "name"), 64),
    categoryIcon: parseUrl(dig(stream, "game", "boxArtURL")),
    tags: freeformTags(stream.freeformTags),
    language: language(stream.language),
  };
}

/**
 * Flatten Twitch's `freeformTags` objects into plain strings.
 *
 * @param value - The `freeformTags` array from the GraphQL response.
 * @returns Tag names, or `undefined` when none were usable.
 */
function freeformTags(value: unknown): string[] | undefined {
  const entries = asArray(value);
  if (!entries) return undefined;

  const names = entries
    .map((entry) => text(dig(entry, "name"), 64))
    .filter((name): name is string => name !== undefined);

  return names.length > 0 ? names.slice(0, 10) : undefined;
}
