import { AddBoxIcon, CursorIcon } from "../icons";
import { m } from "../../paraglide/messages";

/** Theme colors shared by the canvas drawing and the layer legend. */
export const CANVAS_COLORS = {
  box: "var(--success)",
  selected: "var(--accent)",
  handle: "var(--background)",
} as const;

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
  { key: "boxes", label: m.workbench_layer_boxes, color: CANVAS_COLORS.box },
  { key: "ids", label: m.workbench_layer_ids, color: CANVAS_COLORS.box },
] as const;
export type LayerKey = (typeof LAYERS)[number]["key"];
