/**
 * Tests for `src/ui/modals.ts`.
 *
 * Discord's August 2025 modal restructure moved text inputs out of Action Rows
 * and into `Label` components, and discord.js does not validate the resulting
 * limits — an over-long label or a sixth top-level component builds cleanly and
 * is rejected by the API when a user opens the modal. These tests assert the
 * shape and the limits the builder is responsible for enforcing itself.
 *
 * @module tests/ui/modals.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, ComponentType } from "discord.js";
import { MINIMAL_ENV, withEnv } from "../helpers/env.js";
import { PLATFORM_IDS } from "../../src/types/streamer.js";

type ModalsModule = typeof import("../../src/ui/modals.js");

let buildAddStreamerModal: ModalsModule["buildAddStreamerModal"];
let ADD_MODAL_FIELDS: ModalsModule["ADD_MODAL_FIELDS"];
let restoreEnv: (() => void) | undefined;

/** Discord's cap on a `Label`'s text. */
const MAX_LABEL_LENGTH = 45;

/** Discord's cap on a `Label`'s description. */
const MAX_LABEL_DESCRIPTION_LENGTH = 100;

/** Discord's cap on a modal title. */
const MAX_MODAL_TITLE_LENGTH = 45;

/** The serialised shape of one top-level `Label` and its wrapped child. */
interface LabelNode {
  type: number;
  label: string;
  description?: string;
  component: { type: number; custom_id: string; required?: boolean } & Record<
    string,
    unknown
  >;
}

/** The serialised shape of the whole modal. */
interface ModalNode {
  custom_id: string;
  title?: string;
  components: LabelNode[];
}

/** Build the modal and return its serialised form. */
function buildJson(defaultPlatform?: Parameters<
  ModalsModule["buildAddStreamerModal"]
>[0]): ModalNode {
  return buildAddStreamerModal(defaultPlatform).toJSON() as unknown as ModalNode;
}

/** Find the label wrapping the child with the given custom id. */
function labelFor(modal: ModalNode, customId: string): LabelNode {
  const found = modal.components.find(
    (component) => component.component.custom_id === customId,
  );
  if (!found) throw new Error(`no label wraps "${customId}"`);
  return found;
}

beforeEach(async () => {
  restoreEnv = withEnv(MINIMAL_ENV);
  vi.resetModules();
  ({ buildAddStreamerModal, ADD_MODAL_FIELDS } = await import(
    "../../src/ui/modals.js"
  ));
});

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
  vi.resetModules();
});

describe("buildAddStreamerModal structure", () => {
  it("produces exactly four top-level Label components", () => {
    const modal = buildJson();

    expect(modal.components).toHaveLength(4);
    for (const component of modal.components) {
      expect(component.type).toBe(ComponentType.Label);
      expect(component.type).toBe(18);
    }
  });

  it("stays one under Discord's five-component modal cap", () => {
    expect(buildJson().components.length).toBeLessThan(5);
  });

  it("carries a decodable custom id", () => {
    expect(buildJson().custom_id).toBe("add:modal");
  });

  it("collects every field declared in ADD_MODAL_FIELDS", () => {
    const modal = buildJson();
    const ids = modal.components.map((component) => component.component.custom_id);

    expect(ids.sort()).toEqual(Object.values(ADD_MODAL_FIELDS).sort());
  });
});

describe("buildAddStreamerModal child types", () => {
  it("wraps the platform field in a string select", () => {
    expect(labelFor(buildJson(), ADD_MODAL_FIELDS.platform).component.type).toBe(
      ComponentType.StringSelect,
    );
  });

  it("wraps the username field in a text input", () => {
    expect(labelFor(buildJson(), ADD_MODAL_FIELDS.username).component.type).toBe(
      ComponentType.TextInput,
    );
  });

  it("wraps the channel field in a channel select", () => {
    expect(labelFor(buildJson(), ADD_MODAL_FIELDS.channel).component.type).toBe(
      ComponentType.ChannelSelect,
    );
  });

  it("wraps the role field in a role select", () => {
    expect(labelFor(buildJson(), ADD_MODAL_FIELDS.role).component.type).toBe(
      ComponentType.RoleSelect,
    );
  });

  it("uses the numeric component types Discord documents", () => {
    const modal = buildJson();

    expect(labelFor(modal, ADD_MODAL_FIELDS.platform).component.type).toBe(3);
    expect(labelFor(modal, ADD_MODAL_FIELDS.username).component.type).toBe(4);
    expect(labelFor(modal, ADD_MODAL_FIELDS.role).component.type).toBe(6);
    expect(labelFor(modal, ADD_MODAL_FIELDS.channel).component.type).toBe(8);
  });
});

describe("buildAddStreamerModal required flags", () => {
  it("requires platform, username, and channel", () => {
    const modal = buildJson();

    for (const field of [
      ADD_MODAL_FIELDS.platform,
      ADD_MODAL_FIELDS.username,
      ADD_MODAL_FIELDS.channel,
    ]) {
      expect(labelFor(modal, field).component.required).toBe(true);
    }
  });

  it("leaves the mention role optional", () => {
    expect(labelFor(buildJson(), ADD_MODAL_FIELDS.role).component.required).toBe(
      false,
    );
  });

  // Modal children must never set `disabled`; Discord rejects the modal, and
  // `required` is the intended way to express an optional field.
  it("sets no disabled flag on any child", () => {
    for (const component of buildJson().components) {
      expect(component.component).not.toHaveProperty("disabled");
    }
  });
});

describe("buildAddStreamerModal platform options", () => {
  it("offers one option per supported platform", () => {
    const select = labelFor(buildJson(), ADD_MODAL_FIELDS.platform).component;
    const options = select.options as { value: string }[];

    expect(options.map((option) => option.value)).toEqual([...PLATFORM_IDS]);
  });

  it("marks no option as default when no platform is supplied", () => {
    const select = labelFor(buildJson(), ADD_MODAL_FIELDS.platform).component;
    const options = select.options as { default?: boolean }[];

    expect(options.some((option) => option.default === true)).toBe(false);
  });

  it("marks only the supplied platform as default", () => {
    const select = labelFor(buildJson("youtube"), ADD_MODAL_FIELDS.platform)
      .component;
    const options = select.options as { value: string; default?: boolean }[];
    const defaulted = options.filter((option) => option.default === true);

    expect(defaulted).toHaveLength(1);
    expect(defaulted[0]?.value).toBe("youtube");
  });

  it.each(PLATFORM_IDS)("accepts %s as the default platform", (platform) => {
    const select = labelFor(buildJson(platform), ADD_MODAL_FIELDS.platform)
      .component;
    const options = select.options as { value: string; default?: boolean }[];

    expect(
      options.find((option) => option.value === platform)?.default,
    ).toBe(true);
  });
});

describe("buildAddStreamerModal channel restriction", () => {
  // Alerts can only be posted to a channel the bot can send messages in, so
  // the picker is restricted rather than validated after submission.
  it("restricts the channel picker to text and announcement channels", () => {
    const select = labelFor(buildJson(), ADD_MODAL_FIELDS.channel).component;

    expect(select.channel_types).toEqual([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
    ]);
  });

  it("offers no voice, forum, or category channels", () => {
    const select = labelFor(buildJson(), ADD_MODAL_FIELDS.channel).component;
    const types = select.channel_types as number[];

    for (const excluded of [
      ChannelType.GuildVoice,
      ChannelType.GuildForum,
      ChannelType.GuildCategory,
      ChannelType.GuildStageVoice,
    ]) {
      expect(types).not.toContain(excluded);
    }
  });
});

describe("buildAddStreamerModal text limits", () => {
  it(`keeps the modal title within ${MAX_MODAL_TITLE_LENGTH} characters`, () => {
    const title = buildJson().title ?? "";

    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(MAX_MODAL_TITLE_LENGTH);
  });

  it(`keeps every label within ${MAX_LABEL_LENGTH} characters`, () => {
    for (const component of buildJson().components) {
      expect(component.label.length).toBeGreaterThan(0);
      expect(component.label.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    }
  });

  it(`keeps every description within ${MAX_LABEL_DESCRIPTION_LENGTH} characters`, () => {
    for (const component of buildJson().components) {
      expect((component.description ?? "").length).toBeLessThanOrEqual(
        MAX_LABEL_DESCRIPTION_LENGTH,
      );
    }
  });

  it("bounds the username input so an over-long handle cannot be submitted", () => {
    const input = labelFor(buildJson(), ADD_MODAL_FIELDS.username).component;

    expect(input.min_length).toBe(1);
    expect(input.max_length).toBe(100);
  });
});
