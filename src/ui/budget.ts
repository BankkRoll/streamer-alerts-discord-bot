/**
 * Components V2 budget enforcement.
 *
 * Discord rejects a message carrying more than 40 components, counting nested
 * ones, and rejects any single Text Display over 4000 characters. Both
 * failures arrive as an opaque 400 at send time, which is a miserable way to
 * discover a paginated list grew one row too long.
 *
 * These helpers inspect a built payload before it is sent, so a violation is
 * caught during development with a message naming the offending component.
 *
 * Limits verified against `@discordjs/builders` 1.14.1 and Discord's component
 * reference. Note that the per-message aggregate text cap repeated in some
 * guides is **not** in Discord's reference; only the per-component 4000 is
 * enforced by the library, so that is what is checked here.
 *
 * @module ui/budget
 */

import { ComponentType } from "discord.js";
import type { APIMessageTopLevelComponent } from "discord.js";

/** Maximum components in one message, nested components included. */
export const MAX_COMPONENTS_PER_MESSAGE = 40;

/** Maximum characters in a single Text Display component. */
export const MAX_TEXT_DISPLAY_LENGTH = 4000;

/** Maximum Text Display children a Section may hold. */
export const MAX_SECTION_TEXT_CHILDREN = 3;

/** Maximum items in one Media Gallery. */
export const MAX_MEDIA_GALLERY_ITEMS = 10;

/** Maximum buttons in one Action Row. */
export const MAX_BUTTONS_PER_ROW = 5;

/** Maximum options in a String Select. */
export const MAX_SELECT_OPTIONS = 25;

/** A single budget or structural violation. */
export interface BudgetViolation {
  /** Machine-readable violation kind. */
  kind:
    | "too-many-components"
    | "text-too-long"
    | "too-many-section-children"
    | "too-many-gallery-items"
    | "too-many-buttons"
    | "too-many-options"
    | "empty-message";
  /** Human-readable explanation naming the offending component. */
  message: string;
}

/** Result of auditing a component tree. */
export interface BudgetReport {
  /** Total components counted, including nested ones. */
  total: number;
  /** Everything that would cause Discord to reject the payload. */
  violations: BudgetViolation[];
}

/**
 * Walk a component tree, counting nodes and collecting violations.
 *
 * Implemented over the serialised API shape rather than builder instances,
 * because that is what Discord actually receives and what its limits apply to.
 *
 * @param components - Top-level components as they will be sent.
 * @returns The component count and any violations found.
 *
 * @example
 * ```ts
 * const report = auditComponents(container.toJSON() ? [container.toJSON()] : []);
 * if (report.violations.length > 0) throw new Error(report.violations[0].message);
 * ```
 */
export function auditComponents(
  components: readonly APIMessageTopLevelComponent[],
): BudgetReport {
  const violations: BudgetViolation[] = [];
  let total = 0;

  if (components.length === 0) {
    violations.push({
      kind: "empty-message",
      message:
        "A Components V2 message must contain at least one component; " +
        "content and embeds are unavailable under the IsComponentsV2 flag.",
    });
  }

  /** Recursively count one node and validate its container-specific limits. */
  const visit = (component: unknown, path: string): void => {
    if (component === null || typeof component !== "object") return;

    total += 1;
    const node = component as { type?: number; [key: string]: unknown };

    switch (node.type) {
      case ComponentType.TextDisplay: {
        const content = typeof node.content === "string" ? node.content : "";
        if (content.length > MAX_TEXT_DISPLAY_LENGTH) {
          violations.push({
            kind: "text-too-long",
            message: `${path}: Text Display holds ${content.length} characters, exceeding the ${MAX_TEXT_DISPLAY_LENGTH} limit.`,
          });
        }
        break;
      }

      case ComponentType.Section: {
        const children = Array.isArray(node.components) ? node.components : [];
        if (children.length > MAX_SECTION_TEXT_CHILDREN) {
          violations.push({
            kind: "too-many-section-children",
            message: `${path}: Section holds ${children.length} text children, exceeding the ${MAX_SECTION_TEXT_CHILDREN} limit.`,
          });
        }
        children.forEach((child, index) => { visit(child, `${path}.components[${index}]`); },
        );
        if (node.accessory) visit(node.accessory, `${path}.accessory`);
        break;
      }

      case ComponentType.MediaGallery: {
        const items = Array.isArray(node.items) ? node.items : [];
        if (items.length > MAX_MEDIA_GALLERY_ITEMS) {
          violations.push({
            kind: "too-many-gallery-items",
            message: `${path}: Media Gallery holds ${items.length} items, exceeding the ${MAX_MEDIA_GALLERY_ITEMS} limit.`,
          });
        }
        // Gallery items are not themselves components and do not count
        // toward the message total, so they are not visited.
        break;
      }

      case ComponentType.ActionRow: {
        const children = Array.isArray(node.components) ? node.components : [];
        const buttons = children.filter(
          (child): child is { type: number } =>
            typeof child === "object" &&
            child !== null &&
            (child as { type?: number }).type === ComponentType.Button,
        );
        if (buttons.length > MAX_BUTTONS_PER_ROW) {
          violations.push({
            kind: "too-many-buttons",
            message: `${path}: Action Row holds ${buttons.length} buttons, exceeding the ${MAX_BUTTONS_PER_ROW} limit.`,
          });
        }
        children.forEach((child, index) => { visit(child, `${path}.components[${index}]`); },
        );
        break;
      }

      case ComponentType.StringSelect: {
        const options = Array.isArray(node.options) ? node.options : [];
        if (options.length > MAX_SELECT_OPTIONS) {
          violations.push({
            kind: "too-many-options",
            message: `${path}: String Select holds ${options.length} options, exceeding the ${MAX_SELECT_OPTIONS} limit.`,
          });
        }
        break;
      }

      case ComponentType.Container: {
        const children = Array.isArray(node.components) ? node.components : [];
        children.forEach((child, index) => { visit(child, `${path}.components[${index}]`); },
        );
        break;
      }

      default:
        break;
    }
  };

  components.forEach((component, index) => { visit(component, `components[${index}]`); });

  if (total > MAX_COMPONENTS_PER_MESSAGE) {
    violations.push({
      kind: "too-many-components",
      message: `Message contains ${total} components, exceeding Discord's limit of ${MAX_COMPONENTS_PER_MESSAGE}.`,
    });
  }

  return { total, violations };
}

/**
 * Throw when a component tree would be rejected by Discord.
 *
 * Call this on every V2 payload before sending. Failing here produces a stack
 * trace pointing at the builder, instead of an opaque HTTP 400.
 *
 * @param components - Top-level components as they will be sent.
 * @throws When any budget or structural limit is exceeded.
 */
export function assertWithinBudget(
  components: readonly APIMessageTopLevelComponent[],
): void {
  const { violations } = auditComponents(components);
  if (violations.length === 0) return;

  throw new RangeError(
    `Components V2 payload is invalid:\n${violations
      .map((violation) => `  - ${violation.message}`)
      .join("\n")}`,
  );
}

/**
 * Largest page size that keeps a paginated list inside the component budget.
 *
 * Solving for this rather than hardcoding a page size means the list command
 * cannot silently break when a row gains a component.
 *
 * @param componentsPerRow - Components one row contributes.
 * @param chromeComponents - Components used by container, header and controls.
 * @returns How many rows fit, at least 1.
 *
 * @example
 * ```ts
 * // Container + header + separator + pagination row + 2 buttons = 6
 * const perPage = maxRowsPerPage(3, 6); // 11
 * ```
 */
export function maxRowsPerPage(
  componentsPerRow: number,
  chromeComponents: number,
): number {
  if (componentsPerRow <= 0) {
    throw new RangeError("componentsPerRow must be greater than zero");
  }
  const available = MAX_COMPONENTS_PER_MESSAGE - chromeComponents;
  return Math.max(1, Math.floor(available / componentsPerRow));
}
