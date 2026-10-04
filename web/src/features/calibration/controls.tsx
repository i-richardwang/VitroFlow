import { MousePointer2, SquarePlus, type LucideIcon } from "lucide-react";

import { classColor } from "../../domain/models/classes";
import { ColorSwatch } from "../../ui/kit/ColorSwatch";
import { className } from "../../ui/model-names";
import { m } from "../../paraglide/messages";

/** Theme colors of the canvas drawing; boxes take their class's color. */
export const CANVAS_COLORS = {
  selected: "var(--color-info)",
  handle: "var(--color-container)",
  check: "var(--color-warning)",
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
    <span className="inline-flex min-w-0 items-center gap-2">
      <ColorSwatch color={classColor(classes, name).hex} />
      <span className="truncate">{className(name)}</span>
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
    icon: LucideIcon;
  }
> = {
  select: {
    label: m.calibration_tool_select,
    shortcut: "V",
    cursor: "default",
    icon: MousePointer2,
  },
  add: {
    label: m.calibration_tool_add,
    shortcut: "B",
    cursor: "crosshair",
    icon: SquarePlus,
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
  { key: "boxes", label: m.calibration_layer_boxes },
  { key: "ids", label: m.calibration_layer_ids },
  { key: "checks", label: m.calibration_layer_checks },
] as const;
export type LayerKey = (typeof LAYERS)[number]["key"];
