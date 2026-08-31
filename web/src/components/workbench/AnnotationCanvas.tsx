import { Button, Toolbar } from "@heroui/react";
import { useRef, useState } from "react";

import {
  boxAround,
  HANDLES,
  handlePositions,
  moveBox,
  resizeBox,
  type Handle,
  type Point,
} from "../../annotation/geometry";
import { initialBoxSide, instanceFromBox } from "../../annotation/detection";
import type {
  BoundingBox,
  ImageSize,
  LabelInstance,
} from "../../annotation/schema";
import type { DetectionResult } from "../../detection/schema";
import {
  CANVAS_COLORS,
  TOOL_SPECS,
  type LayerKey,
  type Tool,
} from "./controls";
import { useViewport } from "./useViewport";

type Gesture =
  | { kind: "pan"; pointerId: number; originX: number; originY: number }
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

const CLICK_SLOP = 3;
const HANDLE_SCREEN_SIZE = 8;

function isHandle(value: string | null): value is Handle {
  return HANDLES.some((handle) => handle === value);
}

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

export interface Editing {
  tool: Tool;
  panning: boolean;
  className: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onInstancesChange: (instances: LabelInstance[]) => void;
}

export function AnnotationCanvas({
  image,
  filename,
  result,
  instances,
  layers,
  editing,
}: {
  image: ImageSize & { digest: string };
  filename: string;
  result: DetectionResult | null;
  instances: LabelInstance[];
  layers: ReadonlySet<LayerKey>;
  editing?: Editing;
}) {
  const {
    containerRef,
    transform,
    isFitted,
    fit,
    panTo,
    panOrigin,
    toImagePoint,
  } = useViewport(image);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const pressRef = useRef<{
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);

  const tool: Tool = editing?.tool ?? "select";
  const panning = editing?.panning ?? true;
  const selectedId = editing?.selectedId ?? null;
  const onSelect = editing?.onSelect;
  const onInstancesChange = editing?.onInstancesChange;
  const { width, height } = image;

  const startPan = (event: React.PointerEvent): Gesture => {
    const origin = panOrigin(event.clientX, event.clientY);
    return {
      kind: "pan",
      pointerId: event.pointerId,
      originX: origin.x,
      originY: origin.y,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    };
    if (panning || tool === "add") {
      setGesture(startPan(event));
      return;
    }
    const point = toImagePoint(event);
    const target = event.target instanceof Element ? event.target : null;
    const handleValue = target?.getAttribute("data-handle") ?? null;
    const handle = isHandle(handleValue) ? handleValue : null;
    const id =
      target?.closest("[data-instance-id]")?.getAttribute("data-instance-id") ??
      null;
    const instance = instances.find((item) => item.id === id);
    if (handle && instance) {
      setGesture({
        kind: "resize",
        pointerId: event.pointerId,
        id: instance.id,
        handle,
        start: point,
        box: instance.bbox,
      });
      return;
    }
    if (instance) {
      onSelect?.(instance.id);
      setGesture({
        kind: "move",
        pointerId: event.pointerId,
        id: instance.id,
        start: point,
        box: instance.bbox,
      });
      return;
    }
    setGesture(startPan(event));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const press = pressRef.current;
    if (!press || !gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    if (
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
      CLICK_SLOP
    ) {
      press.moved = true;
    }
    if (gesture.kind === "pan") {
      panTo(event.clientX - gesture.originX, event.clientY - gesture.originY);
      return;
    }
    const point = toImagePoint(event);
    const delta = {
      x: point.x - gesture.start.x,
      y: point.y - gesture.start.y,
    };
    const box = instances.find((item) => item.id === gesture.id)?.bbox;
    if (!box) {
      return;
    }
    setGesture(
      gesture.kind === "move"
        ? { ...gesture, box: moveBox(box, delta, image) }
        : {
            ...gesture,
            box: resizeBox(box, gesture.handle, delta, image),
          },
    );
  };

  const finish = (event: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      setGesture(null);
      return;
    }
    setGesture(null);
    if (!press?.moved) {
      if (gesture.kind === "pan" && !panning) {
        if (tool === "add") {
          addBoxAt(toImagePoint(event));
        } else {
          onSelect?.(null);
        }
      }
      return;
    }
    if (gesture.kind === "move" || gesture.kind === "resize") {
      onInstancesChange?.(
        instances.map((item) =>
          item.id === gesture.id ? { ...item, bbox: gesture.box } : item,
        ),
      );
    }
  };

  /**
   * Places the same square the detector uses for existing instances, so added
   * boxes share one convention. The tool stays active for the next instance;
   * switching to select exposes the resize handles.
   */
  const addBoxAt = (center: Point) => {
    if (!editing || !result) return;
    const box = boxAround(center, initialBoxSide(result), image);
    if (!box) {
      return;
    }
    const instance = instanceFromBox(editing.className, box);
    editing.onInstancesChange([...instances, instance]);
    editing.onSelect(instance.id);
  };

  const draft =
    gesture && gesture.kind !== "pan"
      ? { id: gesture.id, box: gesture.box }
      : null;
  const handleSize = HANDLE_SCREEN_SIZE / transform.scale;
  const cursor =
    gesture?.kind === "pan"
      ? "grabbing"
      : panning
        ? "grab"
        : TOOL_SPECS[tool].cursor;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width,
          height,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
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
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {layers.has("dish") && result?.diagnostics?.dish && (
            <circle
              cx={result.diagnostics.dish.center_x}
              cy={result.diagnostics.dish.center_y}
              r={result.diagnostics.dish.radius}
              fill="none"
              stroke={CANVAS_COLORS.dish}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {layers.has("detections") &&
            result?.instances.map((instance) => (
              <circle
                key={instance.id}
                cx={instance.bbox.x + instance.bbox.width / 2}
                cy={instance.bbox.y + instance.bbox.height / 2}
                r={3 / transform.scale}
                fill={CANVAS_COLORS.detection}
                pointerEvents="none"
              >
                <title>{`detection #${instance.id} · score ${instance.score}`}</title>
              </circle>
            ))}
          {layers.has("boxes") &&
            instances.map((instance, index) => {
              const box = draft?.id === instance.id ? draft.box : instance.bbox;
              const selected = instance.id === selectedId;
              return (
                <g key={instance.id} data-instance-id={instance.id}>
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    fill={selected ? CANVAS_COLORS.selected : CANVAS_COLORS.box}
                    fillOpacity={selected ? 0.18 : 0.06}
                    stroke={
                      selected ? CANVAS_COLORS.selected : CANVAS_COLORS.box
                    }
                    strokeWidth={selected ? 2 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      cursor:
                        tool === "select" && !panning ? "move" : undefined,
                    }}
                  />
                  {layers.has("ids") && (
                    <text
                      x={box.x}
                      y={box.y - 3 / transform.scale}
                      fontSize={11 / transform.scale}
                      fill={
                        selected ? CANVAS_COLORS.selected : CANVAS_COLORS.box
                      }
                      pointerEvents="none"
                    >
                      {index + 1}
                    </text>
                  )}
                  {selected &&
                    tool === "select" &&
                    !panning &&
                    HANDLES.map((handle) => {
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
                    })}
                </g>
              );
            })}
        </svg>
      </div>
      <Toolbar
        isAttached
        aria-label="Zoom"
        className="absolute bottom-3 left-1/2 -translate-x-1/2"
      >
        <span className="w-12 text-center font-mono text-xs tabular-nums text-muted">
          {Math.round(transform.scale * 100)}%
        </span>
        <Button variant="ghost" size="sm" isDisabled={isFitted} onPress={fit}>
          Fit
        </Button>
      </Toolbar>
    </div>
  );
}
