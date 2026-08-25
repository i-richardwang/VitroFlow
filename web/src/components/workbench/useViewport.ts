import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Point } from "../../annotation/geometry";
import type { ImageSize } from "../../annotation/schema";

const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Viewport {
  containerRef: React.RefObject<HTMLDivElement | null>;
  transform: Transform;
  /** Scales the image to fit the container and centers it. */
  fit: () => void;
  panTo: (x: number, y: number) => void;
  /** Screen-to-transform offset to hold while dragging from this point. */
  panOrigin: (clientX: number, clientY: number) => Point;
  toImagePoint: (event: { clientX: number; clientY: number }) => Point;
}

/**
 * Maps between screen and image pixels for one image, and owns the pan/zoom
 * transform. Wheel zoom keeps the point under the cursor fixed.
 */
export function useViewport(image: ImageSize): Viewport {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    x: 0,
    y: 0,
  });

  const { width, height } = image;

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const scale = Math.min(
      container.clientWidth / width,
      container.clientHeight / height,
    );
    setTransform({
      scale,
      x: (container.clientWidth - width * scale) / 2,
      y: (container.clientHeight - height * scale) / 2,
    });
  }, [width, height]);

  useLayoutEffect(fit, [fit]);

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
      setTransform((previous) => {
        const scale = Math.min(
          Math.max(
            previous.scale * Math.exp(-event.deltaY * ZOOM_PER_WHEEL_PIXEL),
            MIN_SCALE,
          ),
          MAX_SCALE,
        );
        const ratio = scale / previous.scale;
        return {
          scale,
          x: anchorX - (anchorX - previous.x) * ratio,
          y: anchorY - (anchorY - previous.y) * ratio,
        };
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  return {
    containerRef,
    transform,
    fit,
    panTo: (x, y) => setTransform((previous) => ({ ...previous, x, y })),
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
