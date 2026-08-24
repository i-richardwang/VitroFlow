import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CalibrationState } from '../hooks/useCalibration'
import type { SeedResult } from '../schemas'
import { DetectionsTable } from './DetectionsTable'

const BASES = [
  { key: 'source', label: 'Source' },
  { key: 'overlay', label: 'Overlay' },
  { key: 'debug', label: 'Debug' },
] as const

const LAYERS = [
  { key: 'detections', label: 'Points', dot: '#22c55e' },
  { key: 'ids', label: 'IDs', dot: '#22c55e' },
  { key: 'dish', label: 'Dish', dot: '#a3a3a3' },
  { key: 'measurement', label: 'Measurement', dot: '#3b82f6' },
] as const

const CLICK_SLOP = 3

type BaseKey = (typeof BASES)[number]['key']
type LayerKey = (typeof LAYERS)[number]['key']

interface Transform {
  scale: number
  x: number
  y: number
}

interface DragOrigin {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

export function ImageViewer({
  runId,
  stem,
  result,
  calibration,
}: {
  runId: string
  stem: string
  result: SeedResult
  calibration: CalibrationState
}) {
  const [base, setBase] = useState<BaseKey>('source')
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    detections: true,
    ids: false,
    dish: true,
    measurement: true,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const [drag, setDrag] = useState<DragOrigin | null>(null)
  const draggedRef = useRef(false)
  const pressedMarkerRef = useRef<Element | null>(null)

  const { width, height } = result.image
  const markerRadius = result.dish.radius * result.config.label_window_fraction

  useLayoutEffect(() => {
    const container = containerRef.current!
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height)
    setTransform({
      scale,
      x: (container.clientWidth - width * scale) / 2,
      y: (container.clientHeight - height * scale) / 2,
    })
  }, [width, height])

  useEffect(() => {
    const container = containerRef.current!
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      setTransform((previous) => {
        const scale = Math.min(
          Math.max(previous.scale * Math.exp(-event.deltaY * 0.0015), 0.05),
          40,
        )
        const ratio = scale / previous.scale
        return {
          scale,
          x: cx - (cx - previous.x) * ratio,
          y: cy - (cy - previous.y) * ratio,
        }
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Pointer capture retargets click to the container, so the tap is resolved on
  // pointerup against the element that was actually pressed.
  const calibrateAt = (event: React.PointerEvent) => {
    const marker = pressedMarkerRef.current
    const detectionId = marker?.getAttribute('data-detection-id')
    if (detectionId) {
      calibration.toggleDetection(Number(detectionId))
      return
    }
    const addedIndex = marker?.getAttribute('data-added-index')
    if (addedIndex) {
      calibration.removePoint(Number(addedIndex))
      return
    }
    const rect = containerRef.current!.getBoundingClientRect()
    const x = (event.clientX - rect.left - transform.x) / transform.scale
    const y = (event.clientY - rect.top - transform.y) / transform.scale
    if (x >= 0 && x <= width && y >= 0 && y <= height) {
      calibration.addPoint({ x, y })
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden bg-neutral-950 ${drag ? 'cursor-grabbing' : ''}`}
        onPointerDown={(event) => {
          draggedRef.current = false
          pressedMarkerRef.current = (event.target as Element).closest(
            '[data-detection-id], [data-added-index]',
          )
          setDrag({
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: event.clientX - transform.x,
            originY: event.clientY - transform.y,
          })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag?.pointerId === event.pointerId) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > CLICK_SLOP) {
              draggedRef.current = true
            }
            setTransform((previous) => ({
              ...previous,
              x: event.clientX - drag.originX,
              y: event.clientY - drag.originY,
            }))
          }
        }}
        onPointerUp={(event) => {
          if (!draggedRef.current) {
            calibrateAt(event)
          }
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div
          className={`absolute top-0 left-0 origin-top-left ${drag ? 'cursor-grabbing' : 'cursor-crosshair'}`}
          style={{
            width,
            height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <img
            src={`/img/${runId}/${stem}/${base}`}
            alt={stem}
            width={width}
            height={height}
            draggable={false}
            className="block h-full w-full select-none"
          />
          <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
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
            {layers.measurement && (
              <circle
                cx={result.dish.center_x}
                cy={result.dish.center_y}
                r={result.dish.radius * result.config.measurement_radius_fraction}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {layers.detections &&
              result.detections.map((detection) => {
                const removed = calibration.edit.removed.includes(detection.id)
                return (
                  <circle
                    key={detection.id}
                    cx={detection.x}
                    cy={detection.y}
                    r={markerRadius}
                    fill="transparent"
                    stroke={removed ? '#ef4444' : '#22c55e'}
                    strokeWidth={1.5}
                    strokeDasharray={removed ? '4 3' : undefined}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                    data-detection-id={detection.id}
                  >
                    <title>{`#${detection.id} · score ${detection.score}`}</title>
                  </circle>
                )
              })}
            {layers.detections &&
              calibration.edit.added.map((point, index) => (
                <circle
                  key={`${point.x}:${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={markerRadius}
                  fill="#22c55e"
                  fillOpacity={0.35}
                  stroke="#22c55e"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  data-added-index={index}
                />
              ))}
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
        </div>
        <span className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs tabular-nums text-white/50">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <aside className="flex w-72 shrink-0 flex-col divide-y divide-neutral-200 overflow-y-auto border-l border-neutral-200 bg-white">
        <Section title="Base image">
          <div className="flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Base image">
            {BASES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={base === item.key}
                onClick={() => setBase(item.key)}
                className={`flex-1 rounded-[6px] px-2 py-1 text-xs transition-[scale,background-color] active:scale-95 ${
                  base === item.key
                    ? 'bg-white font-medium shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Layers">
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={layers[item.key]}
                onClick={() =>
                  setLayers((previous) => ({ ...previous, [item.key]: !previous[item.key] }))
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-[scale,background-color] active:scale-95 ${
                  layers[item.key]
                    ? 'bg-neutral-900 text-white'
                    : 'border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.dot }} />
                {item.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Metrics">
          <dl className="space-y-1.5">
            <MetricRow label="Algorithm count" value={String(result.count)} />
            <MetricRow label="Score threshold" value={String(result.score_threshold)} />
            <MetricRow label="Focus score" value={String(result.quality.focus_score)} />
            <MetricRow label="Clipped fraction" value={result.quality.clipped_fraction.toFixed(4)} />
            <MetricRow label="Dish radius" value={`${result.dish.radius.toFixed(0)} px`} />
          </dl>
        </Section>

        <DetectionsTable detections={result.detections} edit={calibration.edit} />
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h2 className="mb-2.5 text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono font-medium tabular-nums">{value}</dd>
    </div>
  )
}
