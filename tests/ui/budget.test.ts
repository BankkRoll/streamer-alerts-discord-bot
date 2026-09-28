/**
 * Tests for `src/ui/budget.ts`.
 *
 * The budget guard exists so a payload that Discord would reject fails during
 * development with a message naming the offending component, instead of as an
 * opaque HTTP 400 at send time. These tests therefore assert on the *contents*
 * of each violation, not merely that one was produced.
 *
 * Fixtures are built as the serialised API shape rather than through builders,
 * because that is the shape the auditor walks and the shape Discord receives.
 *
 * @module tests/ui/budget.test
 */

import { describe, expect, it } from "vitest";
import { ComponentType } from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";
import {
  assertWithinBudget,
  auditComponents,
  MAX_COMPONENTS_PER_MESSAGE,
  MAX_MEDIA_GALLERY_ITEMS,
  MAX_SECTION_TEXT_CHILDREN,
  MAX_SELECT_OPTIONS,
  MAX_TEXT_DISPLAY_LENGTH,
  maxRowsPerPage,
} from "../../src/ui/budget.js";

/**
 * Cast a hand-built API-shaped fixture to the auditor's parameter type.
 *
 * The auditor deliberately accepts malformed trees — its whole job is to
 * reject them — so fixtures cannot always satisfy the strict union.
 *
 * @param components - Hand-built component objects.
 * @returns The same array, typed for the auditor.
 */
function asTopLevel(
  components: readonly unknown[],
): readonly APIMessageTopLevelComponent[] {
  return components as readonly APIMessageTopLevelComponent[];
}

/** A Text Display carrying the given content. */
function text(content: string): unknown {
  return { type: ComponentType.TextDisplay, content };
}

/** A Container wrapping the given children. */
function container(children: readonly unknown[]): unknown {
  return { type: ComponentType.Container, components: children };
}

describe("auditComponents", () => {
  describe("counting", () => {
    it("counts a container, its section, the section's text and its accessory", () => {
      const tree = asTopLevel([
        container([
          {
            type: ComponentType.Section,
            components: [text("headline")],
            accessory: { type: ComponentType.Thumbnail, media: { url: "x" } },
          },
        ]),
      ]);

      // Container + Section + TextDisplay + Thumbnail accessory.
      expect(auditComponents(tree).total).toBe(4);
    });

    it("counts buttons nested inside an action row", () => {
      const tree = asTopLevel([
        container([
          {
            type: ComponentType.ActionRow,
            components: [
              { type: ComponentType.Button, label: "a" },
              { type: ComponentType.Button, label: "b" },
            ],
          },
        ]),
      ]);

      expect(auditComponents(tree).total).toBe(4);
    });

    it("excludes media gallery items from the total, since they are not components", () => {
      const tree = asTopLevel([
        container([
          {
            type: ComponentType.MediaGallery,
            items: Array.from({ length: 5 }, () => ({ media: { url: "x" } })),
          },
        ]),
      ]);

      expect(auditComponents(tree).total).toBe(2);
    });

    it("reports no violations for a well-formed tree", () => {
      expect(auditComponents(asTopLevel([container([text("hi")])])).violations)
        .toEqual([]);
    });
  });

  describe("limits", () => {
    it(`flags a tree exceeding ${MAX_COMPONENTS_PER_MESSAGE} total components`, () => {
      const children = Array.from({ length: MAX_COMPONENTS_PER_MESSAGE }, () =>
        text("x"),
      );
      const report = auditComponents(asTopLevel([container(children)]));

      expect(report.total).toBe(MAX_COMPONENTS_PER_MESSAGE + 1);
      expect(report.violations).toContainEqual(
        expect.objectContaining({ kind: "too-many-components" }),
      );
    });

    it(`accepts a tree of exactly ${MAX_COMPONENTS_PER_MESSAGE} components`, () => {
      const children = Array.from(
        { length: MAX_COMPONENTS_PER_MESSAGE - 1 },
        () => text("x"),
      );
      const report = auditComponents(asTopLevel([container(children)]));

      expect(report.total).toBe(MAX_COMPONENTS_PER_MESSAGE);
      expect(report.violations).toEqual([]);
    });

    it(`flags a Text Display longer than ${MAX_TEXT_DISPLAY_LENGTH} characters`, () => {
      const report = auditComponents(
        asTopLevel([container([text("x".repeat(MAX_TEXT_DISPLAY_LENGTH + 1))])]),
      );

      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]?.kind).toBe("text-too-long");
      // The path must name the offending node, which is the point of the audit.
      expect(report.violations[0]?.message).toContain(
        "components[0].components[0]",
      );
    });

    it(`accepts a Text Display of exactly ${MAX_TEXT_DISPLAY_LENGTH} characters`, () => {
      const report = auditComponents(
        asTopLevel([container([text("x".repeat(MAX_TEXT_DISPLAY_LENGTH))])]),
      );

      expect(report.violations).toEqual([]);
    });

    it(`flags a Section holding more than ${MAX_SECTION_TEXT_CHILDREN} text children`, () => {
      const report = auditComponents(
        asTopLevel([
          container([
            {
              type: ComponentType.Section,
              components: Array.from(
                { length: MAX_SECTION_TEXT_CHILDREN + 1 },
                () => text("x"),
              ),
              accessory: { type: ComponentType.Thumbnail, media: { url: "x" } },
            },
          ]),
        ]),
      );

      expect(report.violations).toContainEqual(
        expect.objectContaining({ kind: "too-many-section-children" }),
      );
    });

    it(`flags a Media Gallery holding more than ${MAX_MEDIA_GALLERY_ITEMS} items`, () => {
      const report = auditComponents(
        asTopLevel([
          container([
            {
              type: ComponentType.MediaGallery,
              items: Array.from({ length: MAX_MEDIA_GALLERY_ITEMS + 1 }, () => ({
                media: { url: "x" },
              })),
            },
          ]),
        ]),
      );

      expect(report.violations).toContainEqual(
        expect.objectContaining({ kind: "too-many-gallery-items" }),
      );
    });

    it("flags an Action Row holding more than 5 buttons", () => {
      const report = auditComponents(
        asTopLevel([
          container([
            {
              type: ComponentType.ActionRow,
              components: Array.from({ length: 6 }, () => ({
                type: ComponentType.Button,
                label: "x",
              })),
            },
          ]),
        ]),
      );

      expect(report.violations).toContainEqual(
        expect.objectContaining({ kind: "too-many-buttons" }),
      );
    });

    it("counts only buttons toward the action row limit, not other children", () => {
      const report = auditComponents(
        asTopLevel([
          container([
            {
              type: ComponentType.ActionRow,
              components: [
                { type: ComponentType.StringSelect, options: [] },
                ...Array.from({ length: 5 }, () => ({
                  type: ComponentType.Button,
                  label: "x",
                })),
              ],
            },
          ]),
        ]),
      );

      expect(
        report.violations.filter(
          (violation) => violation.kind === "too-many-buttons",
        ),
      ).toEqual([]);
    });

    it(`flags a String Select holding more than ${MAX_SELECT_OPTIONS} options`, () => {
      const report = auditComponents(
        asTopLevel([
          container([
            {
              type: ComponentType.StringSelect,
              options: Array.from({ length: MAX_SELECT_OPTIONS + 1 }, (_, i) => ({
                label: `o${i}`,
                value: `${i}`,
              })),
            },
          ]),
        ]),
      );

      expect(report.violations).toContainEqual(
        expect.objectContaining({ kind: "too-many-options" }),
      );
    });

    it("flags an empty component array", () => {
      const report = auditComponents(asTopLevel([]));

      expect(report.total).toBe(0);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]?.kind).toBe("empty-message");
    });

    it("collects every violation rather than stopping at the first", () => {
      const report = auditComponents(
        asTopLevel([
          container([
            text("x".repeat(MAX_TEXT_DISPLAY_LENGTH + 1)),
            {
              type: ComponentType.StringSelect,
              options: Array.from({ length: MAX_SELECT_OPTIONS + 1 }, () => ({
                label: "o",
                value: "v",
              })),
            },
          ]),
        ]),
      );

      expect(report.violations.map((violation) => violation.kind)).toEqual([
        "text-too-long",
        "too-many-options",
      ]);
    });
  });
});

describe("assertWithinBudget", () => {
  it("returns silently for a valid tree", () => {
    expect(() => {
      assertWithinBudget(asTopLevel([container([text("hi")])]));
    }).not.toThrow();
  });

  it("throws a RangeError naming the offending component", () => {
    const tree = asTopLevel([
      container([text("x".repeat(MAX_TEXT_DISPLAY_LENGTH + 1))]),
    ]);

    expect(() => {
      assertWithinBudget(tree);
    }).toThrow(RangeError);
    expect(() => {
      assertWithinBudget(tree);
    }).toThrow(/components\[0\]\.components\[0\]: Text Display holds/);
  });

  it("throws for an empty payload, which Discord rejects under the V2 flag", () => {
    expect(() => {
      assertWithinBudget(asTopLevel([]));
    }).toThrow(RangeError);
  });
});

describe("maxRowsPerPage", () => {
  it("divides the remaining budget by the per-row cost", () => {
    // 40 - 6 chrome = 34 available, 34 / 3 = 11 rows.
    expect(maxRowsPerPage(3, 6)).toBe(11);
  });

  it("floors a fractional result rather than rounding up", () => {
    // 40 - 0 = 40 available, 40 / 7 = 5.71 -> 5.
    expect(maxRowsPerPage(7, 0)).toBe(5);
  });

  it("returns at least 1 even when chrome consumes the whole budget", () => {
    expect(maxRowsPerPage(3, MAX_COMPONENTS_PER_MESSAGE)).toBe(1);
    expect(maxRowsPerPage(3, MAX_COMPONENTS_PER_MESSAGE * 2)).toBe(1);
  });

  it("throws a RangeError when componentsPerRow is zero or negative", () => {
    expect(() => maxRowsPerPage(0, 6)).toThrow(RangeError);
    expect(() => maxRowsPerPage(-1, 6)).toThrow(
      /componentsPerRow must be greater than zero/,
    );
  });
});
