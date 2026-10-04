import { ColorSwatch } from "@heroui/react";

import { classColor } from "../../domain/models/classes";
import { AddBoxIcon, CursorIcon } from "../../ui/icons";
import { className } from "../../ui/model-names";
import { m } from "../../paraglide/messages";

/** Theme colors of the canvas drawing; boxes take their class's color. */
export const CANVAS_COLORS = {
  selected: "var(--accent)",
  handle: "var(--background)",
  check: "var(--warning)",
} as const;

/** A class by its name, beside the color its boxes are drawn in. */
export function ClassLabel({
  classes,
  name,
}: {
  classes: readonly string[];
  name: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <ColorSwatch
        size="xs"
        shape="circle"
        color={classColor(classes, name).hex}
        aria-hidden
      />
      {className(name)}
    </span>
  );
}

/** A model's classes answer to the digit keys, in the order it declares them. */
export function classShortcut(
  classes: readonly string[],
  name: string,
): string | null {
  const index = classes.indexOf(name);
  return classes.length > 1 && index < 9 ? String(index + 1) : null;
}

export function classForShortcut(
  classes: readonly string[],
  key: string,
): string | null {
  return classes.find((name) => classShortcut(classes, name) === key) ?? null;
}

export const TOOLS = ["select", "add"] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_SPECS: Record<
  Tool,
  {
    label: () => string;
    shortcut: string;
    cursor: string;
    icon: React.ComponentType;
  }
> = {
  select: {
    label: m.workbench_tool_select,
    shortcut: "V",
    cursor: "default",
    icon: CursorIcon,
  },
  add: {
    label: m.workbench_tool_add,
    shortcut: "B",
    cursor: "crosshair",
    icon: AddBoxIcon,
  },
};

export function toolForShortcut(key: string): Tool | null {
  return (
    TOOLS.find(
      (tool) => TOOL_SPECS[tool].shortcut.toLowerCase() === key.toLowerCase(),
    ) ?? null
  );
}

export const LAYERS = [
  { key: "boxes", label: m.workbench_layer_boxes },
  { key: "ids", label: m.workbench_layer_ids },
  { key: "checks", label: m.workbench_layer_checks },
] as const;
export type LayerKey = (typeof LAYERS)[number]["key"];
