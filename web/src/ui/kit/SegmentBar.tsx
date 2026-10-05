/*
 * One pill split into proportional segments, for how a set of things divides
 * between states at a glance. Segments with no share are skipped; with
 * nothing to divide it is a quiet track.
 */
export function SegmentBar({
  "aria-label": label,
  segments,
  size = "middle",
}: {
  "aria-label": string;
  segments: { color: string; value: number }[];
  size?: "small" | "middle";
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
