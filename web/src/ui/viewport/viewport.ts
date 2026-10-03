import type { BoundingBox, ImageSize } from "../../domain/annotation/schema";

/** Manual magnification limit; filling the frame always takes precedence. */
export const MAX_SCALE = 40;

/** How many times its own size a focused area spans of the frame around it. */
const FOCUS_CONTEXT = 6;

export interface Size {
  width: number;
  height: number;
}

/**
 * Where the image sits: filling the frame, zoomed and panned by hand, or
 * centered on an area with room around it.
 */
export type ViewIntent =
  | { kind: "fill" }
  | { kind: "manual"; scale: number; x: number; y: number }
  | { kind: "focus"; area: BoundingBox };

export const FILL: ViewIntent = { kind: "fill" };

/** The image placed in the frame, in screen pixels from its top-left corner. */
export interface View {
  scale: number;
  x: number;
  y: number;
  /** True while the image covers the frame, centered, untouched by hand. */
  filled: boolean;
}

/**
 * The scale at which the image just covers the frame: its shorter side,
 * relative to the frame, spans it exactly and the longer side overflows.
 */
function fillScale(frame: Size, image: ImageSize): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** One scale interval for wheel gestures, panning, and frame resizing. */
function constrainedScale(
  requested: number,
  frame: Size,
  image: ImageSize,
): number {
  const minimum = fillScale(frame, image);
  return Math.max(minimum, Math.min(Math.max(minimum, MAX_SCALE), requested));
}

/** Keeps the frame covered along one axis, holding the requested offset. */
function clampOffset(requested: number, extent: number, frame: number): number {
  return Math.min(0, Math.max(frame - extent, requested));
}

/** Where an intent puts the image, before it is kept covering the frame. */
function placement(
  intent: ViewIntent,
  frame: Size,
  image: ImageSize,
): { scale: number; x: number; y: number } {
  switch (intent.kind) {
    case "fill": {
      const scale = fillScale(frame, image);
      return {
        scale,
        x: (frame.width - image.width * scale) / 2,
        y: (frame.height - image.height * scale) / 2,
      };
    }
    case "manual":
      return {
        scale: constrainedScale(intent.scale, frame, image),
        x: intent.x,
        y: intent.y,
      };
    case "focus": {
      const { area } = intent;
      const scale = constrainedScale(
        Math.min(frame.width, frame.height) /
          (FOCUS_CONTEXT * Math.max(area.width, area.height)),
        frame,
        image,
      );
      return {
        scale,
        x: frame.width / 2 - (area.x + area.width / 2) * scale,
        y: frame.height / 2 - (area.y + area.height / 2) * scale,
      };
    }
  }
}

/**
 * Places the image for an intent. The image never shrinks past covering the
 * frame, and cannot be panned to expose the frame behind it. Filling
 * centers the overflowing side; focusing centers the area as nearly as the
 * image's edges allow; a frame not yet measured shows the image as is.
 */
export function resolveView(
  intent: ViewIntent,
  frame: Size | null,
  image: ImageSize,
): View {
  if (!frame || frame.width === 0 || frame.height === 0) {
    return { scale: 1, x: 0, y: 0, filled: intent.kind === "fill" };
  }
  const { scale, x, y } = placement(intent, frame, image);
  return {
    scale,
    x: clampOffset(x, image.width * scale, frame.width),
    y: clampOffset(y, image.height * scale, frame.height),
    filled: intent.kind === "fill",
  };
}

/** Moves the image by hand; the offset is held until the frame is refilled. */
export function pannedTo(view: View, x: number, y: number): ViewIntent {
  return { kind: "manual", scale: view.scale, x, y };
}

/**
 * Zooms about a point of the frame, keeping the image pixel under it still.
 * Zooming out to the filling size or below returns to fill.
 */
export function zoomedAbout(
  view: View,
  anchor: { x: number; y: number },
  scale: number,
  frame: Size,
  image: ImageSize,
): ViewIntent {
  if (scale <= fillScale(frame, image)) return FILL;
  scale = constrainedScale(scale, frame, image);
  const ratio = scale / view.scale;
  return {
    kind: "manual",
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}
