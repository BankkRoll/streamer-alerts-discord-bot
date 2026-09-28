/**
 * Tests for `src/ui/panels.ts`.
 *
 * Panels read `config.ui.itemsPerPage`, so the module is imported dynamically
 * after the environment is installed. Pagination is tested against stale input
 * because a user can click a page button on a message built before streamers
 * were removed, and a panel that throws there leaves the interaction dead.
 *
 * @module tests/ui/panels.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentType, MessageFlags } from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";
import { auditComponents, MAX_SELECT_OPTIONS } from "../../src/ui/budget.js";
import type { Streamer } from "../../src/types/streamer.js";

type PanelsModule = typeof import("../../src/ui/panels.js");

let restoreEnv: (() => void) | undefined;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

/**
 * Import a fresh copy of the panels module under the given environment.
 *
 * @param env - Variables visible while config evaluates.
 * @returns The freshly evaluated module.
 */
async function loadPanels(
  env: Readonly<Record<string, string>> = MINIMAL_ENV,
): Promise<PanelsModule> {
  restoreEnv?.();
  restoreEnv = withEnv(env);
  vi.resetModules();
  return import("../../src/ui/panels.js");
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

/** Build `count` distinct streamers. */
function streamers(count: number, overrides: Partial<Streamer> = {}): Streamer[] {
  return Array.from({ length: count }, (_, index) =>
    streamer({
      id: `twitch:user${index}`,
      username: `user${index}`,
      ...overrides,
    }),
  );
}

/** Minimal structural view of a built component. */
interface Node {
  type: ComponentType;
  content?: string;
  components?: Node[];
  accessory?: Node;
  options?: { label: string; value: string }[];
  disabled?: boolean;
  custom_id?: string;
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

describe("listPageSize", () => {
  it("uses the configured page size when it fits the budget", async () => {
    const { listPageSize } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "3",
    });

    expect(listPageSize()).toBe(3);
  });

  it("defaults to 5 when ITEMS_PER_PAGE is unset", async () => {
    const { listPageSize } = await loadPanels();

    expect(listPageSize()).toBe(5);
  });

  // The budget, not configuration, is the upper bound: a page that exceeds it
  // fails as an opaque 400 from Discord. Config's own 1..10 validation caps
  // the input well below what would break, so the clamp is asserted at the
  // highest value config will accept.
  it("never exceeds what the component budget allows, even at the configured maximum", async () => {
    const { listPageSize, buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "10",
    });

    const size = listPageSize();
    expect(size).toBeLessThanOrEqual(10);

    const payload = buildListPanel(streamers(size * 3), 0);
    expect(auditComponents(payload.components).violations).toEqual([]);
  });

  // REGRESSION: a page size above the budget produced an over-40-component
  // message. ITEMS_PER_PAGE above 10 is now rejected by config validation
  // itself, which is the outer half of the same guard.
  it("is unreachable with an out-of-range ITEMS_PER_PAGE, which config rejects", async () => {
    await expect(
      loadPanels({ ...MINIMAL_ENV, ITEMS_PER_PAGE: "50" }),
    ).rejects.toThrow(/ITEMS_PER_PAGE must be between 1 and 10/);
  });
});

describe("resolvePage", () => {
  it("returns the requested page when it is in range", async () => {
    const { resolvePage } = await loadPanels();

    expect(resolvePage(1, 30, 5)).toEqual({ index: 1, total: 6 });
  });

  // A stale pagination button on an old message can request a page that no
  // longer exists after streamers were removed; clamping keeps the click
  // working instead of erroring the interaction.
  it("clamps a page index above the range to the last page", async () => {
    const { resolvePage } = await loadPanels();

    expect(resolvePage(99, 12, 5)).toEqual({ index: 2, total: 3 });
  });

  it("clamps a negative page index to zero", async () => {
    const { resolvePage } = await loadPanels();

    expect(resolvePage(-5, 30, 5)).toEqual({ index: 0, total: 6 });
  });

  it("reports one page for an empty list rather than zero", async () => {
    const { resolvePage } = await loadPanels();

    expect(resolvePage(0, 0, 5)).toEqual({ index: 0, total: 1 });
    expect(resolvePage(7, 0, 5)).toEqual({ index: 0, total: 1 });
  });

  it("rounds a partial final page up", async () => {
    const { resolvePage } = await loadPanels();

    expect(resolvePage(0, 11, 5).total).toBe(3);
  });

  it("falls back to the configured page size when none is given", async () => {
    const { resolvePage } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "2",
    });

    expect(resolvePage(0, 10).total).toBe(5);
  });
});

describe("buildListPanel", () => {
  it("sets the IsComponentsV2 flag and no mention parsing", async () => {
    const { buildListPanel } = await loadPanels();
    const payload = buildListPanel(streamers(3));

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it("renders the empty state when nothing is tracked", async () => {
    const { buildListPanel } = await loadPanels();
    const node = root(buildListPanel([]).components);

    expect(allText(node)).toContain("No streamers tracked");
    expect(countOfType(node, ComponentType.Section)).toBe(0);
    expect(countOfType(node, ComponentType.ActionRow)).toBe(0);
  });

  it("renders one Section per streamer on the page", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const node = root(buildListPanel(streamers(12), 0).components);

    expect(countOfType(node, ComponentType.Section)).toBe(5);
  });

  it("renders only the remainder on a partial final page", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const node = root(buildListPanel(streamers(12), 2).components);

    expect(countOfType(node, ComponentType.Section)).toBe(2);
  });

  it("reports the total, live count, and page position", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const list = [
      ...streamers(3, { isLive: true }),
      ...streamers(9).map((entry, index) => ({
        ...entry,
        id: `kick:u${index}`,
        username: `u${index}`,
      })),
    ];
    const text = allText(root(buildListPanel(list, 1).components));

    expect(text).toContain("12 total");
    expect(text).toContain("3 live");
    expect(text).toContain("page 2/3");
  });

  it("omits pagination controls when everything fits on one page", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const node = root(buildListPanel(streamers(3)).components);

    expect(countOfType(node, ComponentType.ActionRow)).toBe(0);
  });

  it("adds pagination controls once there is more than one page", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const node = root(buildListPanel(streamers(12), 0).components);
    const row = flatten(node).find(
      (child) => child.type === ComponentType.ActionRow,
    );

    expect(row?.components).toHaveLength(3);
  });

  it("disables Previous on the first page and Next on the last", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });

    const firstRow = flatten(
      root(buildListPanel(streamers(12), 0).components),
    ).find((child) => child.type === ComponentType.ActionRow);
    expect(firstRow?.components?.[0]?.disabled).toBe(true);
    expect(firstRow?.components?.[1]?.disabled).toBe(false);

    const lastRow = flatten(
      root(buildListPanel(streamers(12), 2).components),
    ).find((child) => child.type === ComponentType.ActionRow);
    expect(lastRow?.components?.[0]?.disabled).toBe(false);
    expect(lastRow?.components?.[1]?.disabled).toBe(true);
  });

  it("clamps an out-of-range page rather than rendering an empty page", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const node = root(buildListPanel(streamers(12), 99).components);

    expect(allText(node)).toContain("page 3/3");
    expect(countOfType(node, ComponentType.Section)).toBe(2);
  });

  it("gives each row a link accessory to the streamer's channel", async () => {
    const { buildListPanel } = await loadPanels();
    const node = root(buildListPanel([streamer({ username: "someone" })]).components);
    const section = flatten(node).find(
      (child) => child.type === ComponentType.Section,
    );

    expect(section?.accessory).toMatchObject({
      type: ComponentType.Button,
      url: "https://twitch.tv/someone",
    });
  });

  it("percent-encodes a handle in the row link, so it cannot inject a path", async () => {
    const { buildListPanel } = await loadPanels();
    const node = root(
      buildListPanel([streamer({ username: "a/../b?x=1" })]).components,
    );
    const section = flatten(node).find(
      (child) => child.type === ComponentType.Section,
    );

    expect(JSON.stringify(section?.accessory)).not.toContain("?x=1");
  });

  it("shows paused, live, and offline states", async () => {
    const { buildListPanel } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "5",
    });
    const text = allText(
      root(
        buildListPanel([
          streamer({ id: "a", username: "a", isLive: true, viewers: 1_200 }),
          streamer({ id: "b", username: "b", isLive: false }),
          streamer({
            id: "c",
            username: "c",
            paused: true,
            pausedReason: "channel deleted",
          }),
        ]).components,
      ),
    );

    expect(text).toContain("Live");
    expect(text).toContain("Offline");
    expect(text).toContain("Paused");
    expect(text).toContain("1.2K");
    expect(text).toContain("channel deleted");
  });

  it("stays within the component budget at the maximum page size", async () => {
    const { buildListPanel, listPageSize } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "10",
    });
    // Three pages, so pagination chrome is present on a full page too.
    const payload = buildListPanel(streamers(listPageSize() * 3), 0);
    const report = auditComponents(payload.components);

    expect(report.violations).toEqual([]);
    expect(report.total).toBeLessThanOrEqual(40);
  });

  it("stays within budget with hostile streamer data at the maximum page size", async () => {
    const { buildListPanel, listPageSize } = await loadPanels({
      ...MINIMAL_ENV,
      ITEMS_PER_PAGE: "10",
    });
    const hostile = streamers(listPageSize() * 3).map((entry) => ({
      ...entry,
      displayName: "@everyone **x**".repeat(50),
      pausedReason: "y".repeat(1_000),
      paused: true,
      mentionRoleId: "123",
    }));

    expect(auditComponents(buildListPanel(hostile, 0).components).violations)
      .toEqual([]);
  });
});

describe("buildRemovePanel", () => {
  it("renders the empty-state notice when nothing is tracked", async () => {
    const { buildRemovePanel } = await loadPanels();
    const node = root(buildRemovePanel([]).components);

    expect(allText(node)).toContain("Nothing to remove");
    expect(countOfType(node, ComponentType.StringSelect)).toBe(0);
  });

  it("lists one option per streamer below the cap", async () => {
    const { buildRemovePanel } = await loadPanels();
    const node = root(buildRemovePanel(streamers(4)).components);
    const select = flatten(node).find(
      (child) => child.type === ComponentType.StringSelect,
    );

    expect(select?.options).toHaveLength(4);
  });

  it(`caps options at ${MAX_SELECT_OPTIONS} when more streamers exist`, async () => {
    const { buildRemovePanel } = await loadPanels();
    const node = root(buildRemovePanel(streamers(40)).components);
    const select = flatten(node).find(
      (child) => child.type === ComponentType.StringSelect,
    );

    expect(select?.options).toHaveLength(MAX_SELECT_OPTIONS);
  });

  it("says so when the list was truncated", async () => {
    const { buildRemovePanel } = await loadPanels();
    const text = allText(root(buildRemovePanel(streamers(40)).components));

    expect(text).toContain(`first ${MAX_SELECT_OPTIONS}`);
    expect(text).toContain("40");
  });

  it("does not claim truncation at exactly the cap", async () => {
    const { buildRemovePanel } = await loadPanels();
    const text = allText(
      root(buildRemovePanel(streamers(MAX_SELECT_OPTIONS)).components),
    );

    expect(text).not.toContain("Showing the first");
  });

  it("uses the streamer id as each option value", async () => {
    const { buildRemovePanel } = await loadPanels();
    const node = root(
      buildRemovePanel([streamer({ id: "twitch:someone" })]).components,
    );
    const select = flatten(node).find(
      (child) => child.type === ComponentType.StringSelect,
    );

    expect(select?.options?.[0]?.value).toBe("twitch:someone");
  });

  it("stays within budget at the option cap", async () => {
    const { buildRemovePanel } = await loadPanels();

    expect(auditComponents(buildRemovePanel(streamers(40)).components).violations)
      .toEqual([]);
  });
});

describe("buildRemoveConfirmPanel", () => {
  it("names the streamer, platform, and alert channel", async () => {
    const { buildRemoveConfirmPanel } = await loadPanels();
    const text = allText(
      root(
        buildRemoveConfirmPanel(
          streamer({ displayName: "Someone", channelId: "555" }),
        ).components,
      ),
    );

    expect(text).toContain("Someone");
    expect(text).toContain("Twitch");
    expect(text).toContain("<#555>");
  });

  it("offers a destructive confirm and a cancel", async () => {
    const { buildRemoveConfirmPanel } = await loadPanels();
    const node = root(buildRemoveConfirmPanel(streamer()).components);
    const row = flatten(node).find(
      (child) => child.type === ComponentType.ActionRow,
    );

    expect(row?.components).toHaveLength(2);
    expect(row?.components?.[0]?.custom_id).toContain("remove:confirm");
    expect(row?.components?.[1]?.custom_id).toBe("remove:cancel");
  });

  it("produces a valid in-budget payload", async () => {
    const { buildRemoveConfirmPanel } = await loadPanels();
    const payload = buildRemoveConfirmPanel(streamer());

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(auditComponents(payload.components).violations).toEqual([]);
  });
});

describe("buildNotice", () => {
  it.each([
    ["success", 0x57f287],
    ["error", 0xed4245],
    ["warning", 0xfee75c],
    ["info", 0x5865f2],
  ] as const)("accents a %s notice with its tone colour", async (tone, color) => {
    const { buildNotice } = await loadPanels();

    expect(root(buildNotice(tone, "Title").components).accent_color).toBe(color);
  });

  it("renders the body beneath the title when one is given", async () => {
    const { buildNotice } = await loadPanels();
    const text = allText(
      root(buildNotice("success", "Added", "Tracking now").components),
    );

    expect(text).toContain("Added");
    expect(text).toContain("Tracking now");
  });

  it("renders a title-only notice", async () => {
    const { buildNotice } = await loadPanels();
    const payload = buildNotice("info", "Just a title");

    expect(allText(root(payload.components))).toContain("Just a title");
    expect(auditComponents(payload.components).violations).toEqual([]);
  });

  it("produces a valid in-budget payload", async () => {
    const { buildNotice } = await loadPanels();
    const payload = buildNotice("error", "Failed", "Try again");

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(auditComponents(payload.components).violations).toEqual([]);
  });
});

describe("buildHelpPanel", () => {
  it("lists every command and every supported platform", async () => {
    const { buildHelpPanel } = await loadPanels();
    const text = allText(root(buildHelpPanel().components));

    for (const command of ["/streamer add", "/streamer remove", "/streamer list", "/help", "/ping"]) {
      expect(text).toContain(command);
    }
    for (const platform of ["Kick", "Twitch", "YouTube", "Rumble", "TikTok"]) {
      expect(text).toContain(platform);
    }
  });

  it("reports the configured poll interval in seconds", async () => {
    const { buildHelpPanel } = await loadPanels({
      ...MINIMAL_ENV,
      POLL_INTERVAL_MS: "90000",
    });

    expect(allText(root(buildHelpPanel().components))).toContain("every 90s");
  });

  it("produces a valid in-budget payload", async () => {
    const { buildHelpPanel } = await loadPanels();
    const payload = buildHelpPanel();

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(auditComponents(payload.components).violations).toEqual([]);
  });
});

describe("buildPingPanel", () => {
  it("reports both latencies in milliseconds", async () => {
    const { buildPingPanel } = await loadPanels();
    const text = allText(root(buildPingPanel(42, 87).components));

    expect(text).toContain("42ms");
    expect(text).toContain("87ms");
  });

  it("rounds fractional latencies", async () => {
    const { buildPingPanel } = await loadPanels();
    const text = allText(root(buildPingPanel(41.6, 86.4).components));

    expect(text).toContain("42ms");
    expect(text).toContain("86ms");
  });

  // discord.js reports a gateway ping of -1 before the first heartbeat, which
  // would otherwise render as a nonsensical "-1ms" in a user-facing panel.
  it('renders a negative gateway ping as "measuring…" rather than a negative number', async () => {
    const { buildPingPanel } = await loadPanels();
    const text = allText(root(buildPingPanel(42, -1).components));

    expect(text).toContain("measuring…");
    expect(text).not.toContain("-1ms");
  });

  it("renders a zero gateway ping as a number, not as measuring", async () => {
    const { buildPingPanel } = await loadPanels();
    const text = allText(root(buildPingPanel(42, 0).components));

    expect(text).toContain("0ms");
    expect(text).not.toContain("measuring");
  });

  it("produces a valid in-budget payload", async () => {
    const { buildPingPanel } = await loadPanels();
    const payload = buildPingPanel(42, 87);

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(auditComponents(payload.components).violations).toEqual([]);
  });
});
