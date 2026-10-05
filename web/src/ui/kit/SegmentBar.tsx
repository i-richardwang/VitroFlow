/*
 * One pill split into proportional segments, for how a set of things divides
 * between states at a glance. Segments with no share are skipped; with
 * nothing to divide it is a quiet track, whose color, `--color-fill-secondary`,
 * a segment can take to read as track. With `legend`, a row under the pill
 * names each labelled segment after an 8px dot of its color, set at the end.
 */
interface Segment {
  color: string;
  /** The legend's words for the segment, its count included. */
  label?: string;
  value: number;
}

export function SegmentBar({
  "aria-label": label,
  legend = false,
  segments,
  size = "middle",
}: {
  "aria-label": string;
  legend?: boolean;
  segments: Segment[];
  size?: "small" | "middle";
}) {
  const bar = <Bar label={label} segments={segments} size={size} />;
  if (!legend) return bar;
  return (
    <div className="ui-segment-bar-legend-stack">
      {bar}
      <ul className="ui-segment-bar-legend">
        {segments.map((segment) =>
          segment.label ? (
            <li className="ui-segment-bar-legend-item" key={segment.label}>
              <span
                aria-hidden
                className="ui-segment-bar-legend-dot"
                style={{ background: segment.color }}
              />
              {segment.label}
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function Bar({
  label,
  segments,
  size,
}: {
  label: string;
  segments: Segment[];
  size: "small" | "middle";
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div
      aria-label={label}
      className="ui-segment-bar"
      data-size={size}
      role="img"
    >
      {total > 0
        ? segments.map((segment, index) =>
            segment.value > 0 ? (
              <span
                className="ui-segment-bar-segment"
                key={index}
                style={{
                  background: segment.color,
                  inlineSize: `${(segment.value / total) * 100}%`,
                }}
              />
            ) : null,
          )
        : null}
    </div>
  );
}
