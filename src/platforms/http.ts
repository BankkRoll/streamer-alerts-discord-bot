/**
 * Shared HTTP client for platform checkers.
 *
 * Every platform in this bot is polled through undocumented JSON endpoints or
 * plain HTML scraping. None of them are contractual APIs, so this module
 * concentrates the defensive behaviour they all need in one place:
 *
 * - a timeout on every request, honoured even when the remote never responds;
 * - retries that back off and jitter, restricted to failures that are actually
 *   transient (network faults, 429, 5xx);
 * - a browser-shaped request signature, because several of these hosts serve a
 *   challenge page or a 403 to anything that announces itself as a bot;
 * - a hard ceiling on response size, so a misbehaving or hostile endpoint
 *   cannot exhaust the process heap;
 * - typed errors, so callers can tell "the site said no" from "the network
 *   broke" from "we gave up waiting".
 *
 * @module platforms/http
 */

import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Largest response body this client will buffer, in bytes.
 *
 * Channel pages from YouTube and TikTok are genuinely large (~1-2 MB of
 * embedded JSON), so the cap has to sit well above that while still bounding
 * a single request's memory cost.
 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * User-Agent presented to every platform.
 *
 * These are HTML-scraping endpoints fronted by bot mitigation: TikTok and
 * Rumble return a challenge or an empty shell to non-browser agents, and
 * Kick's Cloudflare rules are stricter still. A current, complete desktop
 * Chrome string is the least likely to be filtered.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Headers sent with every request unless a caller overrides them.
 *
 * `Accept-Language` is not cosmetic: YouTube and TikTok localise the embedded
 * JSON, and parsers here expect the English spellings of subscriber counts and
 * status labels.
 */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "User-Agent": BROWSER_USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
});

/** Base delay for the exponential backoff schedule, in milliseconds. */
const RETRY_BASE_DELAY_MS = 500;

/** Upper bound on a single backoff delay, in milliseconds. */
const RETRY_MAX_DELAY_MS = 10_000;

/**
 * Longest `Retry-After` this client will actually wait.
 *
 * Platforms occasionally answer a 429 with a multi-minute cooldown. Sleeping
 * that long would stall the poll cycle, so anything beyond this is treated as
 * "give up now and retry on the next cycle".
 */
const MAX_RETRY_AFTER_MS = 30_000;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Base class for every failure this module raises.
 *
 * Checkers catch this to produce a descriptive `LiveStatus.error` rather than
 * leaking a raw `TypeError: fetch failed` to the user.
 */
export class PlatformHttpError extends Error {
  /**
   * @param message - Human-readable description of the failure.
   * @param options - Standard error options; `cause` is preserved for logs.
   */
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The server responded, but with a status this client treats as a failure.
 *
 * @example
 * ```ts
 * try {
 *   await fetchJson<Channel>("https://kick.com/api/v2/channels/xqc");
 * } catch (error) {
 *   if (error instanceof HttpError && error.status === 404) return notFound();
 *   throw error;
 * }
 * ```
 */
export class HttpError extends PlatformHttpError {
  /** HTTP status code returned by the server. */
  public readonly status: number;

  /** Status text returned alongside {@link HttpError.status}. */
  public readonly statusText: string;

  /** Final URL after redirects, useful when a platform bounces to a login page. */
  public readonly url: string;

  /**
   * @param status - HTTP status code.
   * @param statusText - HTTP reason phrase.
   * @param url - URL that produced the response.
   */
  public constructor(status: number, statusText: string, url: string) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

/**
 * The request exceeded its deadline, or the caller's signal aborted it.
 *
 * Distinguished from {@link NetworkError} because a timeout usually means the
 * platform is slow or rate-limiting silently, not that it is unreachable.
 */
export class TimeoutError extends PlatformHttpError {
  /** Deadline that elapsed, in milliseconds. */
  public readonly timeoutMs: number;

  /**
   * @param timeoutMs - The deadline that was exceeded.
   * @param options - Standard error options.
   */
  public constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`Request timed out after ${timeoutMs}ms`, options);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The request never produced a response: DNS failure, connection reset, TLS
 * error, or a body that failed mid-stream.
 */
export class NetworkError extends PlatformHttpError {
  /**
   * @param message - Description of the transport failure.
   * @param options - Standard error options.
   */
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * The response body was well-formed HTTP but not usable: over the size cap, or
 * not the JSON it claimed to be.
 */
export class ResponseError extends PlatformHttpError {}

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

/** Per-request options accepted by {@link fetchText} and {@link fetchJson}. */
export interface RequestOptions {
  /** HTTP method. Defaults to `GET`. */
  method?: "GET" | "POST";
  /** Extra headers, merged over the browser-shaped defaults. */
  headers?: Record<string, string>;
  /** Request body. Only meaningful with `method: "POST"`. */
  body?: string;
  /**
   * Caller's cancellation signal, combined with the internal timeout.
   *
   * Aborting it stops retries immediately — a shutdown should not wait out a
   * backoff schedule.
   */
  signal?: AbortSignal;
  /** Overrides {@link Config.polling.requestTimeoutMs} for this request. */
  timeoutMs?: number;
  /** Overrides {@link Config.polling.maxRetries} for this request. */
  maxRetries?: number;
  /**
   * Statuses to accept instead of throwing.
   *
   * Used by checkers that treat a 404 as "no such channel" — a meaningful
   * answer — rather than as an error worth reporting.
   */
  acceptStatuses?: readonly number[];
  /** Maximum bytes to buffer. Defaults to {@link MAX_RESPONSE_BYTES}. */
  maxBytes?: number;
  /**
   * Redirect handling. Defaults to `follow`.
   *
   * Spelled out rather than using the DOM `RequestRedirect` alias, which the
   * Node typings do not expose under `lib: ES2022`.
   */
  redirect?: "follow" | "error" | "manual";
}

/** A response body plus the metadata checkers need to interpret it. */
export interface HttpResponse<T> {
  /** Parsed body: decoded text, or the deserialised JSON value. */
  data: T;
  /** HTTP status code. */
  status: number;
  /** Final URL after any redirects. YouTube's `/live` handler relies on this. */
  url: string;
  /** Whether the request was redirected away from the requested URL. */
  redirected: boolean;
}

// -----------------------------------------------------------------------------
// Retry policy
// -----------------------------------------------------------------------------

/**
 * Decide whether a failed attempt is worth repeating.
 *
 * Only transient conditions qualify. A 4xx other than 429 means the request
 * itself is wrong — a missing channel, a banned account, a rejected user agent
 * — and repeating it wastes the poll budget and antagonises rate limiters.
 *
 * @param error - The failure from the previous attempt.
 * @returns `true` when the same request may succeed on a later attempt.
 *
 * @example
 * ```ts
 * isRetryable(new HttpError(503, "Service Unavailable", url)); // true
 * isRetryable(new HttpError(404, "Not Found", url));           // false
 * ```
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  // A timeout may be a slow upstream rather than a dead one, so one more
  // attempt is reasonable; NetworkError covers resets and DNS blips.
  return error instanceof NetworkError || error instanceof TimeoutError;
}

/**
 * Interpret a `Retry-After` header.
 *
 * The header is specified in two forms and platforms use both: Kick sends
 * delta-seconds, some Cloudflare edges send an HTTP-date. Anything unparseable,
 * negative, or beyond {@link MAX_RETRY_AFTER_MS} yields `undefined` so the
 * caller falls back to its own backoff.
 *
 * @param header - Raw header value, or `null` when absent.
 * @returns Milliseconds to wait, or `undefined` when the value is unusable.
 *
 * @example
 * ```ts
 * parseRetryAfter("5");                             // 5000
 * parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"); // ms until that instant
 * parseRetryAfter("soon");                          // undefined
 * ```
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const trimmed = header.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    const ms = seconds * 1000;
    if (ms < 0 || ms > MAX_RETRY_AFTER_MS) return undefined;
    return ms;
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;

  const ms = date - Date.now();
  if (ms <= 0 || ms > MAX_RETRY_AFTER_MS) return undefined;
  return ms;
}

/**
 * Compute the delay before the next attempt.
 *
 * Full jitter (a uniform draw from `[0, backoff]`) rather than a fixed
 * multiple: the poller fires many checkers at once, and synchronised retries
 * would recreate the burst that triggered the rate limit.
 *
 * @param attempt - Zero-based index of the attempt that just failed.
 * @returns Milliseconds to sleep before retrying.
 */
function backoffDelay(attempt: number): number {
  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );
  return Math.round(Math.random() * exponential);
}

/**
 * Sleep, but wake early and throw if the caller aborts.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional cancellation signal.
 */
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(abortReason(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Normalise a signal's abort reason into an `Error`. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new PlatformHttpError("Request aborted by caller");
}

// -----------------------------------------------------------------------------
// Core request
// -----------------------------------------------------------------------------

/**
 * Read a response body with a hard byte ceiling.
 *
 * `response.text()` would buffer whatever the server sends, so the body is
 * streamed and abandoned the moment it crosses the cap. `Content-Length` is
 * checked first as a cheap early exit, but it is advisory — a chunked response
 * omits it, hence the running total.
 *
 * @param response - Response whose body should be read.
 * @param maxBytes - Ceiling in bytes.
 * @returns The decoded body text.
 * @throws {ResponseError} When the body exceeds `maxBytes`.
 * @throws {NetworkError} When the stream fails mid-transfer.
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseError(
      `Response body of ${declared} bytes exceeds the ${maxBytes} byte limit`,
    );
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += (value as Uint8Array).byteLength;
      if (total > maxBytes) {
        throw new ResponseError(
          `Response body exceeded the ${maxBytes} byte limit`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    throw new NetworkError(
      `Failed while reading response body: ${describe(error)}`,
      { cause: error },
    );
  } finally {
    // Releasing the lock lets undici reclaim the socket even when we bailed
    // out early on the size cap.
    reader.cancel().catch(() => undefined);
  }
}

/** Best-effort human-readable rendering of an unknown thrown value. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error
      ? `${error.message} (${error.cause.message})`
      : error.message;
  }
  return String(error);
}

/**
 * Perform a single attempt: build the combined signal, issue the request, and
 * normalise every failure mode into this module's error types.
 */
async function attemptRequest(
  url: string,
  options: RequestOptions,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ text: string; response: Response }> {
  // AbortSignal.any lets the caller's cancellation and our own deadline race
  // without either one having to know about the other.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { ...DEFAULT_HEADERS, ...options.headers },
      body: options.body,
      redirect: options.redirect ?? "follow",
      signal,
    });
  } catch (error) {
    // The caller aborting is not our failure to classify — surface it as-is so
    // the retry loop stops rather than backing off.
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (timeoutSignal.aborted) throw new TimeoutError(timeoutMs, { cause: error });
    throw new NetworkError(`Request failed: ${describe(error)}`, {
      cause: error,
    });
  }

  if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
    // Draining is required before discarding, or undici keeps the connection
    // pinned until it is garbage collected.
    await response.body?.cancel().catch(() => undefined);
    const error = new HttpError(
      response.status,
      response.statusText,
      response.url || url,
    );
    if (response.status === 429) {
      retryAfterHint.set(error, parseRetryAfter(response.headers.get("retry-after")));
    }
    throw error;
  }

  const text = await readBodyCapped(response, maxBytes);
  return { text, response };
}

/**
 * Side table carrying the server's `Retry-After` hint alongside a 429.
 *
 * Kept off {@link HttpError} itself so the public error shape stays minimal;
 * a `WeakMap` avoids retaining errors that callers have already discarded.
 */
const retryAfterHint = new WeakMap<HttpError, number | undefined>();

/**
 * Fetch a URL as text, with timeout, retries, and a size cap.
 *
 * @param url - Absolute URL to request.
 * @param options - Per-request overrides.
 * @returns The decoded body plus status and final URL.
 * @throws {HttpError} On a non-OK status that is not in `acceptStatuses`.
 * @throws {TimeoutError} When the deadline elapses on every attempt.
 * @throws {NetworkError} When the transport fails on every attempt.
 * @throws {ResponseError} When the body exceeds the size cap.
 *
 * @example
 * ```ts
 * const { data, url } = await fetchText("https://www.youtube.com/@user/live", {
 *   acceptStatuses: [404],
 * });
 * ```
 */
export async function fetchText(
  url: string,
  options: RequestOptions = {},
): Promise<HttpResponse<string>> {
  const timeoutMs = options.timeoutMs ?? config.polling.requestTimeoutMs;
  const maxRetries = options.maxRetries ?? config.polling.maxRetries;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { text, response } = await attemptRequest(
        url,
        options,
        timeoutMs,
        maxBytes,
      );
      return {
        data: text,
        status: response.status,
        url: response.url || url,
        redirected: response.redirected,
      };
    } catch (error) {
      lastError = error;

      // A caller-initiated abort must never be retried; it means shutdown.
      if (options.signal?.aborted) throw error;
      if (attempt === maxRetries || !isRetryable(error)) throw error;

      const hinted =
        error instanceof HttpError ? retryAfterHint.get(error) : undefined;
      const wait = hinted ?? backoffDelay(attempt);

      logger.debug(
        `[http] ${url} attempt ${attempt + 1}/${maxRetries + 1} failed ` +
          `(${describe(error)}); retrying in ${wait}ms`,
      );
      await delay(wait, options.signal);
    }
  }

  // Unreachable: the loop either returns or throws. Kept so the function has a
  // definite return type under noImplicitReturns.
  throw lastError instanceof Error
    ? lastError
    : new PlatformHttpError("Request failed with no recorded error");
}

/**
 * Fetch a URL and parse the body as JSON.
 *
 * The result is typed as `T` on the caller's assertion: these are undocumented
 * endpoints, so every field must still be validated before use.
 *
 * @typeParam T - Expected shape of the response body.
 * @param url - Absolute URL to request.
 * @param options - Per-request overrides. `Accept: application/json` is added.
 * @returns The parsed body plus status and final URL.
 * @throws {ResponseError} When the body is not valid JSON.
 *
 * @example
 * ```ts
 * const { data } = await fetchJson<KickChannel>(
 *   "https://kick.com/api/v2/channels/xqc",
 *   { signal },
 * );
 * ```
 */
export async function fetchJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<HttpResponse<T>> {
  const result = await fetchText(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });

  try {
    return { ...result, data: JSON.parse(result.data) as T };
  } catch (error) {
    // A JSON endpoint answering with HTML almost always means a Cloudflare
    // interstitial or a login wall, so say that rather than echoing a parser
    // error about an unexpected "<".
    const looksLikeHtml = result.data.trimStart().startsWith("<");
    throw new ResponseError(
      looksLikeHtml
        ? "Expected JSON but received an HTML page (likely a bot-protection challenge)"
        : `Expected JSON but the body could not be parsed: ${describe(error)}`,
      { cause: error },
    );
  }
}
