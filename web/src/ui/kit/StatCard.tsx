import type { ReactNode } from "react";
import { Card } from "./Card";

/** A row of metric tiles that wraps to fit. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

/** Metric tile: a label, a figure and an optional line under it. */
export function StatCard({
  hint,
  label,
  value,
}: {
  /** Line under the figure. */
  hint?: string;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card>
      <div className="ui-stat-card-label">{label}</div>
      <div className="ui-stat-card-value">{value}</div>
      {hint ? <div className="ui-stat-card-hint">{hint}</div> : null}
    </Card>
  );
}
