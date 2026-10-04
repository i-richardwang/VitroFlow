import type { ReactNode } from "react";

/*
 * A page's figures in one row without cards: each item is a figure over its
 * label, items are 24px apart with a 28px rule between them, and the row
 * wraps on a narrow screen. An item's `hint` sits under the label, such as a
 * thin `Progress` or the figure's denominator.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return <dl className="ui-stat-strip">{children}</dl>;
}

export function StatStripItem({
  hint,
  label,
  value,
}: {
  hint?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="ui-stat-strip-item">
      <dt className="ui-stat-strip-label">{label}</dt>
      <dd className="ui-stat-strip-value">{value}</dd>
      {hint != null ? <dd className="ui-stat-strip-hint">{hint}</dd> : null}
    </div>
  );
}
