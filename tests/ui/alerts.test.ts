/**
 * Tests for `src/ui/alerts.ts`.
 *
 * An alert renders text scraped from a third-party page into a public channel,
 * which makes the sanitising and mention-control assertions here security
 * tests: a stream title must not be able to ping a guild, style a container,
 * or inject a URL Discord will reject.
 *
 * The module imports config transitively, so it is loaded dynamically after
 * the environment is installed.
 *
 * @module tests/ui/alerts.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentType, MessageFlags } from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";
import type { LiveStatus, Streamer } from "../../src/types/streamer.js";

type AlertsModule = typeof import("../../src/ui/alerts.js");
type BudgetModule = typeof import("../../src/ui/budget.js");

let buildLiveAlert: AlertsModule["buildLiveAlert"];
let buildEndedAlert: AlertsModule["buildEndedAlert"];
let auditComponents: BudgetModule["auditComponents"];
let restoreEnv: (() => void) | undefined;

beforeEach(async () => {
  restoreEnv = withEnv(MINIMAL_ENV);
  vi.resetModules();
  ({ buildLiveAlert, buildEndedAlert } = await import("../../src/ui/alerts.js"));
  ({ auditComponents } = await import("../../src/ui/budget.js"));
});

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

/** A minimal live status; individual tests layer optional fields on top. */
function liveStatus(overrides: Partial<LiveStatus> = {}): LiveStatus {
  return {
    isLive: true,
    platform: "twitch",
    username: "someone",
    url: "https://twitch.tv/someone",
    ...overrides,
  };
}

/** A minimal tracked streamer. */
function streamer(overrides: Partial<Streamer> = {}): Streamer {
  return {
    id: "twitch:someone",
    platform: "twitch",
    username: "someone",
    channelId: "100000000000000000",
    isLive: false,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Minimal structural view of a built component, for traversal in assertions. */
interface Node {
  type: ComponentType;
  content?: string;
  components?: Node[];
  accessory?: Node;
  items?: unknown[];
  accent_color?: number;
}

/** Read the single top-level component as a traversable node. */
function root(components: readonly APIMessageTopLevelComponent[]): Node {
  return components[0] as unknown as Node;
}

/** Collect every node in a tree, depth first. */
function flatten(node: Node): Node[] {
  const children = [
    ...(node.components ?? []),
    ...(node.accessory ? [node.accessory] : []),
  ];
  return [node, ...children.flatMap(flatten)];
}

/** Concatenate every Text Display's content in a tree. */
function allText(node: Node): string {
  return flatten(node)
    .filter((child) => child.type === ComponentType.TextDisplay)
    .map((child) => child.content ?? "")
    .join("\n");
}

/** Count nodes of one component type in a tree. */
function countOfType(node: Node, type: ComponentType): number {
  return flatten(node).filter((child) => child.type === type).length;
}

describe("buildLiveAlert structure", () => {
  it("always sets the IsComponentsV2 flag", () => {
    const payload = buildLiveAlert(liveStatus());

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.flags).toBe(32_768);
  });

  it("renders exactly one top-level Container", () => {
    const payload = buildLiveAlert(liveStatus());

    expect(payload.components).toHaveLength(1);
    expect(root(payload.components).type).toBe(ComponentType.Container);
  });

  it("accents the container with the platform's brand colour", () => {
    expect(root(buildLiveAlert(liveStatus({ platform: "twitch" })).components).accent_color)
      .toBe(0x9146ff);
    expect(root(buildLiveAlert(liveStatus({ platform: "kick", url: "https://kick.com/x" })).components).accent_color)
      .toBe(0x53fc18);
    expect(root(buildLiveAlert(liveStatus({ platform: "youtube", url: "https://youtube.com/@x" })).components).accent_color)
      .toBe(0xff0000);
  });

  it("names the platform and streamer in the headline", () => {
    const text = allText(root(buildLiveAlert(liveStatus()).components));

    expect(text).toContain("someone");
    expect(text).toContain("Twitch");
  });

  it("includes a link button pointing at the stream", () => {
    const node = root(buildLiveAlert(liveStatus()).components);
    const row = flatten(node).find(
      (child) => child.type === ComponentType.ActionRow,
    );

    expect(row?.components?.[0]).toMatchObject({
      type: ComponentType.Button,
      url: "https://twitch.tv/someone",
    });
  });

  it("prefers the display name over the handle when present", () => {
    const text = allText(
      root(buildLiveAlert(liveStatus({ displayName: "Someone Cool" })).components),
    );

    expect(text).toContain("Someone Cool");
  });
});

describe("buildLiveAlert mention control", () => {
  // A stream title is attacker-controlled text rendered into a public channel.
  // Escaping is only half the defence; allowedMentions is the half Discord
  // actually enforces, so both are asserted on the same payload.
  it("defuses bold, spoiler, and @everyone in a scraped title", () => {
    const payload = buildLiveAlert(
      liveStatus({ title: "**bold** ||spoiler|| @everyone <@123>" }),
    );
    const text = allText(root(payload.components));

    expect(text).toContain("\\*\\*bold\\*\\*");
    expect(text).toContain("\\|\\|spoiler\\|\\|");
    expect(text).toContain("@\u200Beveryone");
    // Unescaped markdown and a live @everyone must not survive.
    expect(text).not.toContain("**bold**");
    expect(text).not.toContain("||spoiler||");
    expect(text).not.toMatch(/(?<!\u200B)@everyone/);
  });

  it("removes an explicit user mention from the rendered title", () => {
    const payload = buildLiveAlert(liveStatus({ title: "hello <@123> there" }));
    const text = allText(root(payload.components));

    expect(text).not.toContain("<@123>");
  });

  it("removes an explicit role mention from the rendered title", () => {
    const payload = buildLiveAlert(liveStatus({ title: "hi <@&456>" }));

    expect(allText(root(payload.components))).not.toContain("<@&456>");
  });

  it("parses no mentions by default", () => {
    expect(buildLiveAlert(liveStatus()).allowedMentions).toEqual({ parse: [] });
  });

  it("allows only the configured role to be pinged", () => {
    const payload = buildLiveAlert(liveStatus(), {
      mentionRoleId: "999888777666555444",
    });

    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.allowedMentions.roles).toEqual(["999888777666555444"]);
  });

  it("never grants a role allowance a caller did not ask for", () => {
    const payload = buildLiveAlert(
      liveStatus({ title: "@everyone <@&111> now" }),
    );

    expect(payload.allowedMentions.roles).toBeUndefined();
  });

  it("escapes markdown in the display name as well as the title", () => {
    const payload = buildLiveAlert(
      liveStatus({ displayName: "**not a heading**" }),
    );

    expect(allText(root(payload.components))).toContain("\\*\\*not a heading\\*\\*");
  });

  it("escapes markdown in the category", () => {
    const payload = buildLiveAlert(liveStatus({ category: "||hidden||" }));

    expect(allText(root(payload.components))).not.toContain("||hidden||");
  });
});

describe("buildLiveAlert optional fields", () => {
  it("omits the Section when there is no avatar, since a Section needs an accessory", () => {
    const node = root(buildLiveAlert(liveStatus({ title: "t" })).components);

    expect(countOfType(node, ComponentType.Section)).toBe(0);
    expect(allText(node)).toContain("t");
  });

  it("uses a Section with a thumbnail accessory when an avatar is present", () => {
    const node = root(
      buildLiveAlert(
        liveStatus({ profileImage: "https://cdn.example/a.png" }),
      ).components,
    );
    const section = flatten(node).find(
      (child) => child.type === ComponentType.Section,
    );

    expect(section).toBeDefined();
    expect(section?.accessory?.type).toBe(ComponentType.Thumbnail);
  });

  it("omits the Media Gallery when there is no thumbnail", () => {
    const node = root(buildLiveAlert(liveStatus()).components);

    expect(countOfType(node, ComponentType.MediaGallery)).toBe(0);
  });

  it("adds a single-item Media Gallery when a thumbnail is present", () => {
    const node = root(
      buildLiveAlert(
        liveStatus({ thumbnail: "https://cdn.example/t.png" }),
      ).components,
    );
    const gallery = flatten(node).find(
      (child) => child.type === ComponentType.MediaGallery,
    );

    expect(gallery?.items).toHaveLength(1);
  });

  it("omits the separator when there are no stats and no tags", () => {
    const node = root(buildLiveAlert(liveStatus()).components);

    expect(countOfType(node, ComponentType.Separator)).toBe(0);
  });

  it("adds a separator once any stat is present", () => {
    const node = root(buildLiveAlert(liveStatus({ viewers: 10 })).components);

    expect(countOfType(node, ComponentType.Separator)).toBe(1);
  });

  it("adds a separator when only tags are present", () => {
    const node = root(buildLiveAlert(liveStatus({ tags: ["speedrun"] })).components);

    expect(countOfType(node, ComponentType.Separator)).toBe(1);
  });

  it("degrades to a headline plus a link when every optional field is missing", () => {
    const node = root(buildLiveAlert(liveStatus()).components);

    expect(node.components).toHaveLength(2);
    expect(node.components?.[0]?.type).toBe(ComponentType.TextDisplay);
    expect(node.components?.[1]?.type).toBe(ComponentType.ActionRow);
  });

  it("abbreviates viewer and follower counts", () => {
    const text = allText(
      root(
        buildLiveAlert(liveStatus({ viewers: 1_500, followers: 2_300_000 }))
          .components,
      ),
    );

    expect(text).toContain("1.5K");
    expect(text).toContain("2.3M");
  });

  it("labels YouTube counts as subscribers rather than followers", () => {
    const text = allText(
      root(
        buildLiveAlert(
          liveStatus({
            platform: "youtube",
            url: "https://youtube.com/@someone",
            followers: 1_000,
          }),
        ).components,
      ),
    );

    expect(text).toContain("subscribers");
    expect(text).not.toContain("followers");
  });

  it("omits a negative viewer count rather than rendering it", () => {
    const text = allText(
      root(buildLiveAlert(liveStatus({ viewers: -5 })).components),
    );

    expect(text).not.toContain("-5");
  });

  it("marks verified and mature streams in the headline", () => {
    const text = allText(
      root(
        buildLiveAlert(liveStatus({ verified: true, isMature: true })).components,
      ),
    );

    expect(text).toContain("☑️");
    expect(text).toContain("18+");
  });

  it("drops blank tags and caps the rendered list", () => {
    const text = allText(
      root(
        buildLiveAlert(
          liveStatus({ tags: ["  ", "a", "b", "c", "d", "e", "f"] }),
        ).components,
      ),
    );
    const rendered = text.match(/`[^`]+`/g) ?? [];

    expect(rendered.length).toBeLessThanOrEqual(5);
  });
});

describe("buildLiveAlert URL validation", () => {
  // Discord rejects the entire message when any component carries a malformed
  // URL, so a scraped value that is not absolute http(s) is dropped instead of
  // emitted — losing an avatar is far better than losing the alert.
  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a relative path", "/images/avatar.png"],
    ["a protocol-relative URL", "//cdn.example/a.png"],
    ["garbage", "not a url at all"],
    ["an empty string", ""],
  ])("drops %s supplied as profileImage", (_label, url) => {
    const node = root(
      buildLiveAlert(liveStatus({ profileImage: url })).components,
    );

    expect(countOfType(node, ComponentType.Section)).toBe(0);
    expect(countOfType(node, ComponentType.Thumbnail)).toBe(0);
    if (url !== "") expect(JSON.stringify(node)).not.toContain(url);
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "./thumb.png"],
    ["garbage", "%%%"],
  ])("drops %s supplied as thumbnail", (_label, url) => {
    const node = root(buildLiveAlert(liveStatus({ thumbnail: url })).components);

    expect(countOfType(node, ComponentType.MediaGallery)).toBe(0);
  });

  it("keeps a valid https URL", () => {
    const node = root(
      buildLiveAlert(
        liveStatus({ profileImage: "https://cdn.example/a.png" }),
      ).components,
    );

    expect(JSON.stringify(node)).toContain("https://cdn.example/a.png");
  });

  it("keeps a valid http URL", () => {
    const node = root(
      buildLiveAlert(liveStatus({ thumbnail: "http://cdn.example/t.png" }))
        .components,
    );

    expect(JSON.stringify(node)).toContain("http://cdn.example/t.png");
  });
});

describe("buildLiveAlert truncation", () => {
  it("truncates a very long title rather than exceeding the Text Display limit", () => {
    const node = root(
      buildLiveAlert(liveStatus({ title: "x".repeat(10_000) })).components,
    );
    const contents = flatten(node)
      .filter((child) => child.type === ComponentType.TextDisplay)
      .map((child) => child.content ?? "");

    for (const content of contents) {
      expect(content.length).toBeLessThanOrEqual(4_000);
    }
    expect(contents.some((content) => content.endsWith("…"))).toBe(true);
  });

  it("truncates a very long display name", () => {
    const node = root(
      buildLiveAlert(liveStatus({ displayName: "y".repeat(500) })).components,
    );

    expect(allText(node).length).toBeLessThan(400);
  });

  it("truncates a very long category", () => {
    const node = root(
      buildLiveAlert(liveStatus({ category: "z".repeat(500) })).components,
    );

    expect(allText(node)).toContain("…");
  });

  // A title made entirely of markdown specials doubles in length once escaped,
  // which is the case most likely to push a Text Display past its cap.
  it("stays within the Text Display limit for an all-markdown title", () => {
    const node = root(
      buildLiveAlert(liveStatus({ title: "*".repeat(5_000) })).components,
    );

    for (const child of flatten(node)) {
      if (child.type === ComponentType.TextDisplay) {
        expect((child.content ?? "").length).toBeLessThanOrEqual(4_000);
      }
    }
  });
});

describe("buildEndedAlert", () => {
  it("sets the IsComponentsV2 flag", () => {
    expect(buildEndedAlert(streamer()).flags).toBe(MessageFlags.IsComponentsV2);
  });

  it("renders a single muted Container", () => {
    const payload = buildEndedAlert(streamer());
    const node = root(payload.components);

    expect(payload.components).toHaveLength(1);
    expect(node.type).toBe(ComponentType.Container);
    expect(node.accent_color).toBe(0x4e5058);
  });

  it("renders the end time as a Discord timestamp", () => {
    const payload = buildEndedAlert(streamer(), new Date(1_767_225_600_000));

    expect(allText(root(payload.components))).toContain("<t:1767225600:R>");
  });

  it("names the streamer and platform", () => {
    const text = allText(
      root(buildEndedAlert(streamer({ displayName: "Someone" })).components),
    );

    expect(text).toContain("Someone");
    expect(text).toContain("Twitch");
  });

  it("parses no mentions", () => {
    expect(buildEndedAlert(streamer()).allowedMentions).toEqual({ parse: [] });
  });

  it("escapes markdown in the display name", () => {
    const text = allText(
      root(buildEndedAlert(streamer({ displayName: "**x**" })).components),
    );

    expect(text).toContain("\\*\\*x\\*\\*");
    expect(text).not.toContain("**x**");
  });
});

describe("alert payloads stay within the component budget", () => {
  const platforms = ["kick", "twitch", "youtube", "rumble", "tiktok"] as const;

  it.each(platforms)("produces a valid payload for %s with every field set", (platform) => {
    const payload = buildLiveAlert(
      liveStatus({
        platform,
        url: `https://example.com/${platform}`,
        displayName: "Someone Cool",
        title: "x".repeat(1_000),
        viewers: 12_345,
        followers: 6_789_012,
        category: "Just Chatting",
        startedAt: "2026-01-01T00:00:00.000Z",
        tags: ["a", "b", "c", "d", "e", "f", "g"],
        profileImage: "https://cdn.example/a.png",
        thumbnail: "https://cdn.example/t.png",
        verified: true,
        isMature: true,
      }),
      { mentionRoleId: "1" },
    );

    expect(auditComponents(payload.components).violations).toEqual([]);
  });

  it("produces a valid payload for a bare status", () => {
    expect(auditComponents(buildLiveAlert(liveStatus()).components).violations)
      .toEqual([]);
  });

  it("produces a valid ended payload", () => {
    expect(auditComponents(buildEndedAlert(streamer()).components).violations)
      .toEqual([]);
  });

  it("produces a valid payload under hostile input", () => {
    const payload = buildLiveAlert(
      liveStatus({
        displayName: "@everyone".repeat(50),
        title: "||".repeat(3_000),
        category: "<script>".repeat(100),
        tags: Array.from({ length: 50 }, () => "`".repeat(30)),
        profileImage: "javascript:alert(1)",
        thumbnail: "not-a-url",
      }),
    );

    expect(auditComponents(payload.components).violations).toEqual([]);
  });
});
