import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { assertedSeeds, consumedIds, correctionOwners } from "../calibration";
import type { CalibrationState } from "../hooks/useCalibration";
import type { Point, SeedResult } from "../schemas";
import { CorrectionsList } from "./CorrectionsList";
import { DetectionsTable } from "./DetectionsTable";

const VIEWS = [
  { key: "source", label: "Source", interactive: true },
  { key: "overlay", label: "Overlay", interactive: true },
  { key: "debug", label: "Debug", interactive: false },
] as const;

const LAYERS = [
  { key: "detections", label: "Points", dot: "#22c55e" },
  { key: "ids", label: "IDs", dot: "#22c55e" },
  { key: "dish", label: "Dish", dot: "#a3a3a3" },
  { key: "analysis", label: "Analysis regions", dot: "#3b82f6" },
] as const;

const CLICK_SLOP = 3;
const MARKER_SELECTOR = "[data-detection-id], [data-correction-index]";

type ViewKey = (typeof VIEWS)[number]["key"];
type LayerKey = (typeof LAYERS)[number]["key"];
type Layers = Record<LayerKey, boolean>;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

// A press either pans the viewport or, from an uncorrected detection, drags a link
// towards another detection to merge them. Which one is decided on pointerdown.
type Gesture =
  | { kind: "pan"; pointerId: number; originX: number; originY: number }
  | {
      kind: "link";
      pointerId: number;
      sourceId: number;
      cursor: Point;
      targetId: number | null;
    };

interface Press {
  marker: Element | null;
  clientX: number;
  clientY: number;
  moved: boolean;
}

function markerDetectionId(element: Element | null): number | null {
  const value = element
    ?.closest("[data-detection-id]")
    ?.getAttribute("data-detection-id");
  return value === null || value === undefined ? null : Number(value);
}

export function ImageViewer({
  runId,
  stem,
  result,
  calibration,
}: {
  runId: string;
  stem: string;
  result: SeedResult;
  calibration: CalibrationState;
}) {
  const [viewKey, setViewKey] = useState<ViewKey>("source");
  const [layers, setLayers] = useState<Layers>({
    detections: true,
    ids: false,
    dish: true,
    analysis: true,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // Pointer capture retargets events to the container, so the pressed marker is kept here.
  const pressRef = useRef<Press | null>(null);

  const view = VIEWS.find((item) => item.key === viewKey)!;
  const { width, height } = result.image;
  const owners = correctionOwners(calibration.corrections);

  useLayoutEffect(() => {
    const container = containerRef.current!;
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

  useEffect(() => {
    const container = containerRef.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setTransform((previous) => {
        const scale = Math.min(
          Math.max(previous.scale * Math.exp(-event.deltaY * 0.0015), 0.05),
          40,
        );
        const ratio = scale / previous.scale;
        return {
          scale,
          x: cx - (cx - previous.x) * ratio,
          y: cy - (cy - previous.y) * ratio,
        };
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const toImagePoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - transform.x) / transform.scale,
      y: (event.clientY - rect.top - transform.y) / transform.scale,
    };
  };

  // A tap on a corrected marker reverts its correction; on an uncorrected detection it
  // removes (or with ⌥ splits) it; on bare image it adds a seed.
  const tap = (event: React.PointerEvent) => {
    const marker = pressRef.current?.marker ?? null;
    const correctionIndex = marker?.getAttribute("data-correction-index");
    if (correctionIndex) {
      calibration.revert(Number(correctionIndex));
      return;
    }
    const detectionId = markerDetectionId(marker);
    if (detectionId !== null) {
      const owner = owners.get(detectionId);
      if (owner !== undefined) {
        calibration.revert(owner);
      } else if (event.altKey) {
        calibration.splitDetection(detectionId, toImagePoint(event));
      } else {
        calibration.removeDetection(detectionId);
      }
      return;
    }
    const point = toImagePoint(event);
    if (point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height) {
      calibration.addSeed(point);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden bg-neutral-950 ${
          gesture?.kind === "pan" ? "cursor-grabbing" : ""
        }`}
        onPointerDown={(event) => {
          const marker = (event.target as Element).closest(MARKER_SELECTOR);
          pressRef.current = {
            marker,
            clientX: event.clientX,
            clientY: event.clientY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);

          const sourceId = markerDetectionId(marker);
          if (view.interactive && sourceId !== null && !owners.has(sourceId)) {
            setGesture({
              kind: "link",
              pointerId: event.pointerId,
              sourceId,
              cursor: toImagePoint(event),
              targetId: null,
            });
            return;
          }
          setGesture({
            kind: "pan",
            pointerId: event.pointerId,
            originX: event.clientX - transform.x,
            originY: event.clientY - transform.y,
          });
        }}
        onPointerMove={(event) => {
          const press = pressRef.current;
          if (!press || gesture?.pointerId !== event.pointerId) {
            return;
          }
          if (
            Math.hypot(
              event.clientX - press.clientX,
              event.clientY - press.clientY,
            ) > CLICK_SLOP
          ) {
            press.moved = true;
          }
          if (gesture.kind === "pan") {
            setTransform((previous) => ({
              ...previous,
              x: event.clientX - gesture.originX,
              y: event.clientY - gesture.originY,
            }));
            return;
          }
          const hovered = markerDetectionId(
            document.elementFromPoint(event.clientX, event.clientY),
          );
          setGesture({
            ...gesture,
            cursor: toImagePoint(event),
            targetId:
              hovered !== null && hovered !== gesture.sourceId ? hovered : null,
          });
        }}
        onPointerUp={(event) => {
          const press = pressRef.current;
          if (press && !press.moved) {
            if (view.interactive) {
              tap(event);
            }
          } else if (gesture?.kind === "link" && gesture.targetId !== null) {
            calibration.mergeDetections(gesture.sourceId, gesture.targetId);
          }
          pressRef.current = null;
          setGesture(null);
        }}
        onPointerCancel={() => {
          pressRef.current = null;
          setGesture(null);
        }}
      >
        <div
          className={`absolute top-0 left-0 origin-top-left ${
            gesture?.kind === "pan"
              ? "cursor-grabbing"
              : view.interactive
                ? "cursor-crosshair"
                : "cursor-grab"
          }`}
          style={{
            width,
            height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <img
            src={`/img/${runId}/${stem}/${view.key}`}
            alt={stem}
            width={width}
            height={height}
            draggable={false}
            className="block h-full w-full select-none"
          />
          {view.interactive && (
            <AnnotationLayer
              result={result}
              calibration={calibration}
              owners={owners}
              layers={layers}
              link={gesture?.kind === "link" ? gesture : null}
            />
          )}
        </div>
        <span className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs tabular-nums text-white/50">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <aside className="flex w-72 shrink-0 flex-col divide-y divide-neutral-200 overflow-y-auto border-l border-neutral-200 bg-white">
        <Section title="View">
          <div
            className="flex rounded-lg bg-neutral-100 p-0.5"
            role="group"
            aria-label="View"
          >
            {VIEWS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={viewKey === item.key}
                onClick={() => setViewKey(item.key)}
                className={`flex-1 rounded-[6px] px-2 py-1 text-xs transition-[scale,background-color] active:scale-95 ${
                  viewKey === item.key
                    ? "bg-white font-medium shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Section>

        {view.interactive && (
          <Section title="Layers">
            <div className="flex flex-wrap gap-1.5">
              {LAYERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={layers[item.key]}
                  onClick={() =>
                    setLayers((previous) => ({
                      ...previous,
                      [item.key]: !previous[item.key],
                    }))
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-[scale,background-color] active:scale-95 ${
                    layers[item.key]
                      ? "bg-neutral-900 text-white"
                      : "border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: item.dot }}
                  />
                  {item.label}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Metrics">
          <dl className="space-y-1.5">
            <MetricRow label="Algorithm count" value={String(result.count)} />
            <MetricRow
              label="Confidence threshold"
              value={String(result.confidence_threshold)}
            />
            <MetricRow label="Model" value={result.model.name} />
            <MetricRow
              label="Focus score"
              value={String(result.quality.focus_score)}
            />
            <MetricRow
              label="Clipped fraction"
              value={result.quality.clipped_fraction.toFixed(4)}
            />
            <MetricRow
              label="Dish radius"
              value={`${result.dish.radius.toFixed(0)} px`}
            />
          </dl>
        </Section>

        <Section title="Corrections">
          <CorrectionsList
            corrections={calibration.corrections}
            onRevert={calibration.revert}
          />
        </Section>

        <DetectionsTable
          detections={result.detections}
          corrections={calibration.corrections}
        />
      </aside>
    </div>
  );
}

const MARKER_STROKE: Record<"kept" | "removed" | "replaced", string> = {
  kept: "#22c55e",
  removed: "#ef4444",
  replaced: "#a3a3a3",
};

function AnnotationLayer({
  result,
  calibration,
  owners,
  layers,
  link,
}: {
  result: SeedResult;
  calibration: CalibrationState;
  owners: Map<number, number>;
  layers: Layers;
  link: Extract<Gesture, { kind: "link" }> | null;
}) {
  const { width, height } = result.image;
  const markerRadius =
    result.dish.radius * result.config.rendering.region_radius_fraction;
  const byId = new Map(
    result.detections.map((detection) => [detection.id, detection]),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 h-full w-full"
    >
      {layers.dish && (
        <circle
          cx={result.dish.center_x}
          cy={result.dish.center_y}
          r={result.dish.radius}
          fill="none"
          stroke="#f8fafc"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {layers.analysis && (
        <>
          <circle
            cx={result.dish.center_x}
            cy={result.dish.center_y}
            r={
              result.dish.radius *
              result.config.geometry.reference_radius_fraction
            }
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={result.dish.center_x}
            cy={result.dish.center_y}
            r={
              result.dish.radius * result.config.geometry.search_radius_fraction
            }
            fill="none"
            stroke="#d946ef"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {layers.detections && (
        <>
          {result.detections.map((detection) => {
            const owner = owners.get(detection.id);
            const state =
              owner === undefined
                ? "kept"
                : calibration.corrections[owner].type === "remove"
                  ? "removed"
                  : "replaced";
            const targeted = link?.targetId === detection.id;
            return (
              <circle
                key={detection.id}
                cx={detection.x}
                cy={detection.y}
                r={markerRadius}
                fill={targeted ? "#22c55e" : "transparent"}
                fillOpacity={0.35}
                stroke={MARKER_STROKE[state]}
                strokeWidth={targeted ? 3 : 1.5}
                strokeDasharray={state === "kept" ? undefined : "4 3"}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                data-detection-id={detection.id}
              >
                <title>{`#${detection.id} · score ${detection.score}`}</title>
              </circle>
            );
          })}
          {calibration.corrections.map((correction, index) => {
            const sources = consumedIds(correction).map((id) => byId.get(id)!);
            return (
              <g
                key={index}
                data-correction-index={index}
                className="cursor-pointer"
              >
                {assertedSeeds(correction).map((seed, seedIndex) => (
                  <g key={seedIndex}>
                    {sources.map((source) => (
                      <line
                        key={source.id}
                        x1={source.x}
                        y1={source.y}
                        x2={seed.x}
                        y2={seed.y}
                        stroke="#22c55e"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <circle
                      cx={seed.x}
                      cy={seed.y}
                      r={markerRadius}
                      fill="#22c55e"
                      fillOpacity={0.35}
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            );
          })}
          {link && (
            <line
              x1={byId.get(link.sourceId)!.x}
              y1={byId.get(link.sourceId)!.y}
              x2={link.cursor.x}
              y2={link.cursor.y}
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </>
      )}
      {layers.ids &&
        result.detections.map((detection) => (
          <text
            key={detection.id}
            x={detection.x + markerRadius}
            y={detection.y - markerRadius}
            fontSize={markerRadius * 1.2}
            fill="#22c55e"
          >
            {detection.id}
          </text>
        ))}
    </svg>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <h2 className="mb-2.5 text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono font-medium tabular-nums">{value}</dd>
    </div>
  );
}
