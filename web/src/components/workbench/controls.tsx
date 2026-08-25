import type { ImageKind } from "../../detection/schema";
import { AddBoxIcon, CursorIcon, HandIcon } from "../icons";

/** Colors shared by the canvas drawing and the layer legend. */
export const CANVAS_COLORS = {
  box: "#22c55e",
  selected: "#3b82f6",
  detection: "#facc15",
  dish: "#a3a3a3",
  handle: "#ffffff",
} as const;

export const TOOLS = ["select", "add", "pan"] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_SPECS: Record<
  Tool,
  {
    label: string;
    shortcut: string;
    cursor: string;
    icon: React.ComponentType;
  }
> = {
  select: {
    label: "Select",
    shortcut: "V",
    cursor: "default",
    icon: CursorIcon,
  },
  add: {
    label: "Add box",
    shortcut: "B",
    cursor: "crosshair",
    icon: AddBoxIcon,
  },
  pan: { label: "Pan", shortcut: "H", cursor: "grab", icon: HandIcon },
};

export function toolForShortcut(key: string): Tool | null {
  return (
    TOOLS.find(
      (tool) => TOOL_SPECS[tool].shortcut.toLowerCase() === key.toLowerCase(),
    ) ?? null
  );
}

export const VIEW_LABELS: Record<ImageKind, string> = {
  source: "Source",
  overlay: "Overlay",
  debug: "Debug",
};

/** Only the source image carries annotations; the rendered views are read-only. */
export function isEditableView(view: ImageKind): boolean {
  return view === "source";
}

export const LAYERS = [
  { key: "boxes", label: "Boxes", color: CANVAS_COLORS.box },
  { key: "ids", label: "IDs", color: CANVAS_COLORS.box },
  { key: "detections", label: "Detections", color: CANVAS_COLORS.detection },
  { key: "dish", label: "Dish", color: CANVAS_COLORS.dish },
] as const;
export type LayerKey = (typeof LAYERS)[number]["key"];
