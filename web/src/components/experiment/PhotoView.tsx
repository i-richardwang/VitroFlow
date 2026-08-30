import type { DetectionResult } from "../../detection/schema";

/**
 * The photograph with every detected seed outlined. Boxes are drawn in the
 * image's own pixel space and scale with it; nothing here can be edited.
 */
export function PhotoView({
  digest,
  filename,
  width,
  height,
  detection,
}: {
  digest: string;
  filename: string;
  width: number;
  height: number;
  detection: DetectionResult | null;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-surface-secondary">
      <img
        src={`/img/${digest}`}
        alt={filename}
        width={width}
        height={height}
        className="block h-auto w-full"
      />
      {detection ? (
        <svg
          aria-hidden
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none absolute inset-0 h-full w-full text-accent"
        >
          {detection.instances.map((instance) => (
            <rect
              key={instance.id}
              x={instance.bbox.x}
              y={instance.bbox.y}
              width={instance.bbox.width}
              height={instance.bbox.height}
              fill="none"
              stroke="currentColor"
              strokeWidth={Math.max(1, width / 800)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
