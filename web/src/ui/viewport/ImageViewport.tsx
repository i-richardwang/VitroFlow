import { Button, Toolbar } from "@heroui/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Point } from "../../domain/annotation/geometry";
import type { ImageSize } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";
import {
  FILL,
  pannedTo,
  resolveView,
  zoomedAbout,
  type Size,
  type ViewIntent,
} from "./viewport";

const ZOOM_PER_WHEEL_PIXEL = 0.0015;
const CLICK_SLOP = 3;

interface ScreenPoint {
  clientX: number;
  clientY: number;
}

/** What a layer drawn over the image needs from the viewport around it. */
export interface ViewportHandle {
  /** Screen pixels per image pixel. */
  scale: number;
  toImagePoint: (event: ScreenPoint) => Point;
  /** Offset to hold between the pointer and the image while dragging. */
  panOrigin: (event: ScreenPoint) => Point;
  panTo: (x: number, y: number) => void;
}

const ViewportContext = createContext<ViewportHandle | null>(null);

export function useViewport(): ViewportHandle {
  const handle = use(ViewportContext);
  if (!handle) throw new Error("useViewport requires ImageViewport");
  return handle;
}

interface Drag {
  pointerId: number;
  origin: Point;
  start: ScreenPoint;
  moved: boolean;
}

/**
 * Drag to pan; release without moving to press. Attached to whichever
 * surface owns the pointer: the frame itself, or a layer over the image.
 */
export function usePanGesture(
  viewport: ViewportHandle,
  onPress?: (point: Point) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  return {
    dragging: drag?.moved === true,
    onPointerDown(event: React.PointerEvent) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        pointerId: event.pointerId,
        origin: viewport.panOrigin(event),
        start: { clientX: event.clientX, clientY: event.clientY },
        moved: false,
      });
    },
    onPointerMove(event: React.PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved =
        drag.moved ||
        Math.hypot(
          event.clientX - drag.start.clientX,
          event.clientY - drag.start.clientY,
        ) > CLICK_SLOP;
      if (!moved) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      viewport.panTo(
        event.clientX - drag.origin.x,
        event.clientY - drag.origin.y,
      );
    },
    onPointerUp(event: React.PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDrag(null);
      if (!drag.moved) onPress?.(viewport.toImagePoint(event));
    },
    onPointerCancel(event: React.PointerEvent) {
      if (drag?.pointerId === event.pointerId) setDrag(null);
    },
  };
}

/**
 * One image covering a frame until zoomed. Wheel zooms about the cursor,
 * dragging pans, and the image re-covers the frame whenever it changes size.
 * Children are drawn over the image in image pixels.
 */
export function ImageViewport({
  image,
  filename,
  children,
}: {
  image: ImageSize & { digest: string };
  filename: string;
  children?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [intent, setIntent] = useState<ViewIntent>(FILL);
  const { width, height } = image;
  const size = useMemo(() => ({ width, height }), [width, height]);
  const view = useMemo(
    () => resolveView(intent, frame, size),
    [intent, frame, size],
  );

  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () =>
      setFrame({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = frameRef.current;
    if (!element || !frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setIntent((current) => {
        const from = resolveView(current, frame, size);
        const scale =
          from.scale * Math.exp(-event.deltaY * ZOOM_PER_WHEEL_PIXEL);
        return zoomedAbout(from, anchor, scale, frame, size);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [frame, size]);

  const panTo = useCallback(
    (x: number, y: number) =>
      setIntent((current) =>
        frame ? pannedTo(resolveView(current, frame, size), x, y) : current,
      ),
    [frame, size],
  );
  const handle = useMemo<ViewportHandle>(
    () => ({
      scale: view.scale,
      toImagePoint: (event) => {
        const rect = frameRef.current!.getBoundingClientRect();
        return {
          x: (event.clientX - rect.left - view.x) / view.scale,
          y: (event.clientY - rect.top - view.y) / view.scale,
        };
      },
      panOrigin: (event) => ({
        x: event.clientX - view.x,
        y: event.clientY - view.y,
      }),
      panTo,
    }),
    [view, panTo],
  );
  const pan = usePanGesture(handle);

  return (
    <div
      ref={frameRef}
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden select-none"
      style={{ cursor: pan.dragging ? "grabbing" : "grab" }}
      onPointerDown={pan.onPointerDown}
      onPointerMove={pan.onPointerMove}
      onPointerUp={pan.onPointerUp}
      onPointerCancel={pan.onPointerCancel}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width,
          height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        <img
          src={`/img/${image.digest}`}
          alt={filename}
          width={width}
          height={height}
          draggable={false}
          className="block h-full w-full"
        />
        <ViewportContext value={handle}>{children}</ViewportContext>
      </div>
      <Toolbar
        isAttached
        aria-label={m.workbench_zoom()}
        className="absolute bottom-3 left-1/2 -translate-x-1/2"
      >
        <span className="w-12 text-center font-mono text-xs tabular-nums text-muted">
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={view.filled}
          onPress={() => setIntent(FILL)}
        >
          {m.workbench_fill()}
        </Button>
      </Toolbar>
    </div>
  );
}
