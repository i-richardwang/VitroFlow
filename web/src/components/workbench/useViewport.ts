import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Point } from "../../annotation/geometry";
import type { ImageSize } from "../../annotation/schema";

const MAX_SCALE = 40;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;
const FIT_EPSILON = 1e-4;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Viewport {
  containerRef: React.RefObject<HTMLDivElement | null>;
  transform: Transform;
  /** True when the image is as small as it can be: filling the frame. */
  isFitted: boolean;
  /** Scales the image to fill the frame and centers it. */
  fit: () => void;
  panTo: (x: number, y: number) => void;
  /** Screen-to-transform offset to hold while dragging from this point. */
  panOrigin: (clientX: number, clientY: number) => Point;
  toImagePoint: (event: { clientX: number; clientY: number }) => Point;
}

function fitScale(
  container: HTMLElement,
  width: number,
  height: number,
): number {
  return Math.min(
    container.clientWidth / width,
    container.clientHeight / height,
  );
}

/**
 * The image cannot shrink past filling the frame. A side smaller than
 * the frame stays centered; a larger side cannot be panned off.
 */
function clampTransform(
  container: HTMLElement,
  width: number,
  height: number,
  t: Transform,
): Transform {
  if (container.clientWidth === 0 || container.clientHeight === 0) {
    return t;
  }
  const scale = Math.min(
    MAX_SCALE,
    Math.max(fitScale(container, width, height), t.scale),
  );
  const w = width * scale;
  const h = height * scale;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  return {
    scale,
    x: w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, t.x)),
    y: h <= ch ? (ch - h) / 2 : Math.min(0, Math.max(ch - h, t.y)),
  };
}

/**
 * Maps between screen and image pixels for one image, and owns the pan/zoom
 * transform. Wheel zoom keeps the point under the cursor fixed. The smallest
 * scale is fit: filling the frame, never smaller.
 */
export function useViewport(image: ImageSize): Viewport {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const [transform, setTransform] = useState<Transform>(transformRef.current);
  const [isFitted, setIsFitted] = useState(true);

  const { width, height } = image;

  const commit = useCallback(
    (next: Transform) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const clamped = clampTransform(container, width, height, next);
      transformRef.current = clamped;
      setIsFitted(
        clamped.scale <= fitScale(container, width, height) + FIT_EPSILON,
      );
      setTransform(clamped);
    },
    [width, height],
  );

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    commit({
      scale: fitScale(container, width, height),
      x: 0,
      y: 0,
    });
  }, [commit, width, height]);

  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(() => commit(transformRef.current));
    observer.observe(container);
    return () => observer.disconnect();
  }, [commit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const previous = transformRef.current;
      const scale =
        previous.scale * Math.exp(-event.deltaY * ZOOM_PER_WHEEL_PIXEL);
      const ratio = scale / previous.scale;
      commit({
        scale,
        x: anchorX - (anchorX - previous.x) * ratio,
        y: anchorY - (anchorY - previous.y) * ratio,
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [commit]);

  return {
    containerRef,
    transform,
    isFitted,
    fit,
    panTo: (x, y) => commit({ ...transformRef.current, x, y }),
    panOrigin: (clientX, clientY) => ({
      x: clientX - transform.x,
      y: clientY - transform.y,
    }),
    toImagePoint: (event) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - transform.x) / transform.scale,
        y: (event.clientY - rect.top - transform.y) / transform.scale,
      };
    },
  };
}
