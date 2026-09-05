import type { ImageSize } from "../../annotation/schema";

/** The largest magnification, in screen pixels per image pixel. */
export const MAX_SCALE = 40;

export interface Size {
  width: number;
  height: number;
}

/** Where the image sits: fitted to the frame, or zoomed and panned by hand. */
export type ViewIntent =
  { kind: "fit" } | { kind: "zoomed"; scale: number; x: number; y: number };

export const FIT: ViewIntent = { kind: "fit" };

/** The image placed in the frame, in screen pixels from its top-left corner. */
export interface View {
  scale: number;
  x: number;
  y: number;
  /** True when the image is as small as the frame allows. */
  fitted: boolean;
}

/** The scale at which the image just fills the frame. */
export function fitScale(frame: Size, image: ImageSize): number {
  return Math.min(frame.width / image.width, frame.height / image.height);
}

function centeredOrClamped(
  requested: number,
  extent: number,
  frame: number,
): number {
  if (extent <= frame) return (frame - extent) / 2;
  return Math.min(0, Math.max(frame - extent, requested));
}

/**
 * Places the image for an intent. The image never shrinks past filling the
 * frame; a side smaller than the frame stays centered, a larger side cannot
 * be panned off. A frame not yet measured shows the image as is.
 */
export function resolveView(
  intent: ViewIntent,
  frame: Size | null,
  image: ImageSize,
): View {
  if (!frame || frame.width === 0 || frame.height === 0) {
    return { scale: 1, x: 0, y: 0, fitted: true };
  }
  const fit = fitScale(frame, image);
  const scale =
    intent.kind === "fit"
      ? fit
      : Math.min(MAX_SCALE, Math.max(fit, intent.scale));
  const requested = intent.kind === "fit" ? { x: 0, y: 0 } : intent;
  return {
    scale,
    x: centeredOrClamped(requested.x, image.width * scale, frame.width),
    y: centeredOrClamped(requested.y, image.height * scale, frame.height),
    fitted: scale === fit,
  };
}

/**
 * Zooms about a point of the frame, keeping the image pixel under it still.
 * Zooming out to the fitted size or below returns to fit.
 */
export function zoomedAbout(
  view: View,
  anchor: { x: number; y: number },
  scale: number,
  frame: Size,
  image: ImageSize,
): ViewIntent {
  if (scale <= fitScale(frame, image)) return FIT;
  const ratio = scale / view.scale;
  return {
    kind: "zoomed",
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}
