import { useState } from "react";

import {
  boxAround,
  HANDLES,
  handlePositions,
  moveBox,
  resizeBox,
  type Handle,
  type Point,
} from "../../domain/annotation/geometry";
import type { Check } from "../../domain/annotation/checks";
import {
  initialBoxSide,
  instanceFromBox,
} from "../../domain/annotation/detection";
import type {
  AnnotationInstance,
  BoundingBox,
  ImageSize,
} from "../../domain/annotation/schema";
import { classColor } from "../../domain/models/classes";
import {
  CANVAS_COLORS,
  TOOL_SPECS,
  type LayerKey,
  type Tool,
} from "./controls";
import { usePanGesture, useViewport } from "../../ui/viewport/ImageViewport";

const HANDLE_SCREEN_SIZE = 8;

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

function isHandle(value: string | null): value is Handle {
  return HANDLES.some((handle) => handle === value);
}

function Layer({
  image,
  children,
  ...handlers
}: React.SVGProps<SVGSVGElement> & { image: ImageSize }) {
  return (
    <svg
      viewBox={`0 0 ${image.width} ${image.height}`}
      className="absolute inset-0 h-full w-full overflow-visible"
      {...handlers}
    >
      {children}
    </svg>
  );
}

function Box({
  box,
  color,
  ordinal,
  selected = false,
  cursor,
  children,
}: {
  box: BoundingBox;
  color: string;
  ordinal?: number;
  selected?: boolean;
  cursor?: string;
  children?: React.ReactNode;
}) {
  const { scale } = useViewport();
  const paint = selected ? CANVAS_COLORS.selected : color;
  return (
    <>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={paint}
        fillOpacity={selected ? 0.18 : 0.06}
        stroke={paint}
        strokeWidth={selected ? 2 : 1.5}
        vectorEffect="non-scaling-stroke"
        style={{ cursor }}
      />
      {ordinal !== undefined ? (
        <text
          x={box.x}
          y={box.y - 3 / scale}
          fontSize={11 / scale}
          fill={paint}
          pointerEvents="none"
        >
          {ordinal}
        </text>
      ) : null}
      {children}
    </>
  );
}

export function BoxLayer({
  image,
  classes,
  instances,
  layers,
}: {
  image: ImageSize;
  classes: readonly string[];
  instances: AnnotationInstance[];
  layers: ReadonlySet<LayerKey>;
}) {
  if (!layers.has("boxes")) return null;
  return (
    <Layer image={image}>
      {instances.map((instance, index) => (
        <Box
          key={instance.id}
          box={instance.bbox}
          color={classColor(classes, instance.class).hex}
          ordinal={layers.has("ids") ? index + 1 : undefined}
        />
      ))}
    </Layer>
  );
}

/**
 * The places a proposal asks a person to look at, outlined over the boxes:
 * an unsure box is ringed, a questioned area is ringed and marked "?".
 */
export function ChecksLayer({
  image,
  checks,
  layers,
}: {
  image: ImageSize;
  checks: Check[];
  layers: ReadonlySet<LayerKey>;
}) {
  const { scale } = useViewport();
  if (!layers.has("checks") || checks.length === 0) return null;
  const gap = 3 / scale;
  return (
    <Layer image={image} pointerEvents="none">
      {checks.map(({ kind, bbox }, index) => (
        <g key={index}>
          <rect
            x={bbox.x - gap}
            y={bbox.y - gap}
            width={bbox.width + 2 * gap}
            height={bbox.height + 2 * gap}
            fill="none"
            stroke={CANVAS_COLORS.check}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {kind === "issue" ? (
            <text
              x={bbox.x + bbox.width + gap}
              y={bbox.y - gap}
              fontSize={13 / scale}
              fontWeight={600}
              fill={CANVAS_COLORS.check}
            >
              ?
            </text>
          ) : null}
        </g>
      ))}
    </Layer>
  );
}

type BoxGesture =
  | {
      kind: "move";
      pointerId: number;
      id: string;
      start: Point;
      box: BoundingBox;
    }
  | {
      kind: "resize";
      pointerId: number;
      id: string;
      handle: Handle;
      start: Point;
      box: BoundingBox;
    };

/**
 * The boxes of a draft. Select and drag a box to move it, drag a handle to
 * resize it; press empty image to add a box or clear the selection. Holding
 * space pans instead, as does dragging empty image.
 */
export function EditableBoxLayer({
  image,
  classes,
  instances,
  layers,
  tool,
  panning,
  activeClass,
  selectedId,
  onSelect,
  onInstancesChange,
}: {
  image: ImageSize;
  classes: readonly string[];
  instances: AnnotationInstance[];
  layers: ReadonlySet<LayerKey>;
  tool: Tool;
  panning: boolean;
  activeClass: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onInstancesChange: (instances: AnnotationInstance[]) => void;
}) {
  const viewport = useViewport();
  const [gesture, setGesture] = useState<BoxGesture | null>(null);
  const editable = tool === "select" && !panning;

  /**
   * Places a square the size of the boxes already on the image, so added
   * boxes share one convention. The tool stays active for the next instance;
   * switching to select exposes the resize handles.
   */
  const addBoxAt = (center: Point) => {
    const box = boxAround(center, initialBoxSide(instances, image), image);
    if (!box) return;
    const instance = instanceFromBox(activeClass, box);
    onInstancesChange([...instances, instance]);
    onSelect(instance.id);
  };

  const pan = usePanGesture(viewport, (point) => {
    if (panning) return;
    if (tool === "add") addBoxAt(point);
    else onSelect(null);
  });

  const onPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (!editable) {
      pan.onPointerDown(event);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const handleValue = target?.getAttribute("data-handle") ?? null;
    const handle = isHandle(handleValue) ? handleValue : null;
    const id =
      target?.closest("[data-instance-id]")?.getAttribute("data-instance-id") ??
      null;
    const instance = instances.find((item) => item.id === id);
    if (!instance) {
      pan.onPointerDown(event);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = viewport.toImagePoint(event);
    if (handle) {
      setGesture({
        kind: "resize",
        pointerId: event.pointerId,
        id: instance.id,
        handle,
        start,
        box: instance.bbox,
      });
      return;
    }
    onSelect(instance.id);
    setGesture({
      kind: "move",
      pointerId: event.pointerId,
      id: instance.id,
      start,
      box: instance.bbox,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!gesture) {
      pan.onPointerMove(event);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const point = viewport.toImagePoint(event);
    const delta = {
      x: point.x - gesture.start.x,
      y: point.y - gesture.start.y,
    };
    const box = instances.find((item) => item.id === gesture.id)?.bbox;
    if (!box) return;
    setGesture(
      gesture.kind === "move"
        ? { ...gesture, box: moveBox(box, delta, image) }
        : { ...gesture, box: resizeBox(box, gesture.handle, delta, image) },
    );
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!gesture) {
      pan.onPointerUp(event);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    setGesture(null);
    onInstancesChange(
      instances.map((item) =>
        item.id === gesture.id ? { ...item, bbox: gesture.box } : item,
      ),
    );
  };

  const onPointerCancel = (event: React.PointerEvent) => {
    if (!gesture) pan.onPointerCancel(event);
    else if (gesture.pointerId === event.pointerId) setGesture(null);
  };

  const handleSize = HANDLE_SCREEN_SIZE / viewport.scale;
  const cursor = pan.dragging
    ? "grabbing"
    : panning
      ? "grab"
      : TOOL_SPECS[tool].cursor;

  return (
    <Layer
      image={image}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <rect width={image.width} height={image.height} fill="transparent" />
      {layers.has("boxes")
        ? instances.map((instance, index) => {
            const box =
              gesture?.id === instance.id ? gesture.box : instance.bbox;
            const selected = instance.id === selectedId;
            return (
              <g key={instance.id} data-instance-id={instance.id}>
                <Box
                  box={box}
                  color={classColor(classes, instance.class).hex}
                  ordinal={layers.has("ids") ? index + 1 : undefined}
                  selected={selected}
                  cursor={editable ? "move" : undefined}
                >
                  {selected && editable
                    ? HANDLES.map((handle) => {
                        const position = handlePositions(box)[handle];
                        return (
                          <rect
                            key={handle}
                            data-handle={handle}
                            x={position.x - handleSize / 2}
                            y={position.y - handleSize / 2}
                            width={handleSize}
                            height={handleSize}
                            fill={CANVAS_COLORS.handle}
                            stroke={CANVAS_COLORS.selected}
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                            style={{ cursor: HANDLE_CURSORS[handle] }}
                          />
                        );
                      })
                    : null}
                </Box>
              </g>
            );
          })
        : null}
    </Layer>
  );
}
