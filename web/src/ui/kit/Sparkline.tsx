/*
 * A row of bars, oldest to newest, for how one figure moved at a glance.
 * The bars share `width`, each at most 16px wide, so a short series stays a
 * slim row at the end of its box. Bars rise from the baseline in proportion
 * to the largest value, never lower than 3px so a zero still shows; the newest is drawn in the primary
 * color, the earlier ones in a muted success fill. Each bar names its point
 * in a native tooltip.
 */

const HEIGHT = 40;
const GAP = 4;
const MIN_BAR = 3;
const MAX_BAR = 16;

export function Sparkline({
  "aria-label": label,
  points,
  width = 132,
}: {
  "aria-label": string;
  points: { label: string; value: number }[];
  width?: number;
}) {
  const max = Math.max(0, ...points.map((point) => point.value));
  const bar = Math.min(
    MAX_BAR,
    Math.max(MIN_BAR, (width - (points.length - 1) * GAP) / points.length),
  );
  const drawn = points.length * bar + (points.length - 1) * GAP;
  return (
    <svg
      aria-label={label}
      className="ui-sparkline"
      height={HEIGHT}
      role="img"
      viewBox={`0 0 ${drawn} ${HEIGHT}`}
      width={drawn}
    >
      {points.map((point, index) => {
        const height = Math.max(
          MIN_BAR,
          max > 0 ? (point.value / max) * HEIGHT : 0,
        );
        return (
          <rect
            className="ui-sparkline-bar"
            data-latest={index === points.length - 1 ? "" : undefined}
            height={height}
            key={point.label}
            rx={2}
            width={bar}
            x={index * (bar + GAP)}
            y={HEIGHT - height}
          >
            <title>{point.label}</title>
          </rect>
        );
      })}
    </svg>
  );
}
