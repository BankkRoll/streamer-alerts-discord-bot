/**
 * Tests for `src/platforms/youtube.ts`.
 *
 * The pages here are cut down from real `/@handle/live` responses. The gated
 * fixture mirrors what YouTube serves to flagged IPs (issue #6): a full watch
 * page whose player payload is LOGIN_REQUIRED with `videoDetails` removed.
 *
 * @module tests/platforms/youtube.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";

type YouTubeModule = typeof import("../../src/platforms/youtube.js");

const fetchText = vi.fn();
let checkYouTubeLive: YouTubeModule["checkYouTubeLive"];
let restoreEnv: (() => void) | undefined;

beforeEach(async () => {
  restoreEnv = withEnv(MINIMAL_ENV);
  vi.resetModules();
  vi.doMock("../../src/platforms/http.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/platforms/http.js")>()),
    fetchText,
  }));
  ({ checkYouTubeLive } = await import("../../src/platforms/youtube.js"));
});

afterEach(() => {
  fetchText.mockReset();
  vi.doUnmock("../../src/platforms/http.js");
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

const VIDEO_ID = "0sfDth4lMLc";

/** A watch page's `ytInitialData`, live or not. */
function watchData(isLive: boolean): unknown {
  return {
    currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_ID } },
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [
              {
                videoPrimaryInfoRenderer: {
                  title: {
                    runs: [{ text: "lofi beats " }, { text: "#chill" }],
                  },
                  viewCount: {
                    videoViewCountRenderer: isLive
                      ? { isLive: true, originalViewCount: "2628" }
                      : { originalViewCount: "120" },
                  },
                },
              },
              {
                videoSecondaryInfoRenderer: {
                  owner: {
                    videoOwnerRenderer: {
                      title: { runs: [{ text: "Lofi Girl" }] },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

const GATED_PLAYER = {
  playabilityStatus: {
    status: "LOGIN_REQUIRED",
    reason: "Sign in to confirm you're not a bot",
  },
};

function page(player: unknown, initial: unknown): string {
  const parts = ["<html><body>"];
  if (player)
    parts.push(
      `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`,
    );
  if (initial)
    parts.push(
      `<script>var ytInitialData = ${JSON.stringify(initial)};</script>`,
    );
  parts.push("</body></html>");
  return parts.join("");
}

function serve(html: string): void {
  fetchText.mockResolvedValue({
    data: html,
    status: 200,
    url: "",
    redirected: false,
  });
}

describe("checkYouTubeLive", () => {
  it("reads a live stream from the player payload", async () => {
    serve(
      page(
        {
          playabilityStatus: { status: "OK" },
          videoDetails: {
            videoId: VIDEO_ID,
            isLive: true,
            title: "lofi beats",
            author: "Lofi Girl",
            viewCount: "2628",
          },
        },
        watchData(true),
      ),
    );

    const status = await checkYouTubeLive("LofiGirl");

    expect(status.error).toBeUndefined();
    expect(status.isLive).toBe(true);
    expect(status.url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });

  it("falls back to ytInitialData when the bot gate strips videoDetails", async () => {
    serve(page(GATED_PLAYER, watchData(true)));

    const status = await checkYouTubeLive("LofiGirl");

    expect(status).toMatchObject({
      isLive: true,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      username: "Lofi Girl",
      title: "lofi beats #chill",
      viewers: 2628,
      thumbnail: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault_live.jpg`,
    });
    expect(status.error).toBeUndefined();
  });

  it("reports a gated watch page that is not live as offline", async () => {
    serve(page(GATED_PLAYER, watchData(false)));

    const status = await checkYouTubeLive("LofiGirl");

    expect(status.isLive).toBe(false);
    expect(status.error).toBeUndefined();
  });

  it("reports an error, not offline, when the gate leaves nothing to read", async () => {
    serve(page(GATED_PLAYER, { metadata: {} }));

    const status = await checkYouTubeLive("LofiGirl");

    expect(status.isLive).toBe(false);
    expect(status.error).toMatch(/bot-protection/);
  });

  it("treats a channel page without a player payload as offline", async () => {
    serve(
      page(undefined, {
        metadata: { channelMetadataRenderer: { title: "Lofi Girl" } },
      }),
    );

    const status = await checkYouTubeLive("LofiGirl");

    expect(status.isLive).toBe(false);
    expect(status.error).toBeUndefined();
    expect(status.displayName).toBe("Lofi Girl");
  });

  it("flags a watch page with neither payload shape as a parser failure", async () => {
    serve(
      page(undefined, {
        contents: {
          twoColumnWatchNextResults: { results: { results: { contents: [] } } },
        },
      }),
    );

    const status = await checkYouTubeLive("LofiGirl");

    expect(status.isLive).toBe(false);
    expect(status.error).toMatch(/parser needs updating/);
  });
});
