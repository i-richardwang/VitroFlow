import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { Card } from "./Card";
import { Skeleton } from "./Skeleton";

/*
 * Loading shape of a page. `PageSkeleton` is the root: it stacks its parts
 * like the page's content and announces the load in a polite live region.
 * The parts (`PageHeaderSkeleton`, `StatGridSkeleton`, `TableSkeleton`) are
 * laid out in the order the page draws them. Bones are sized by their
 * classes, so the Skeleton default size is cleared with `bone`.
 */

const bone = { height: undefined, width: undefined };
const lineWidths = [
  ["68%", "36%"],
  ["52%", "28%"],
  ["76%", "42%"],
  ["58%", "32%"],
] as const;
const HEAD = [96, 72, 64, 48];

export function PageSkeleton({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true" className="ui-page-skeleton">
      <output aria-live="polite" className="sr-only">
        {m.ui_page_loading()}
      </output>
      {children}
    </div>
  );
}

/** The title row; `description` and `action` match what the page shows. */
export function PageHeaderSkeleton({
  action,
  description,
}: {
  action?: boolean;
  description?: boolean;
}) {
  return (
    <div aria-hidden className="ui-page-skeleton-header">
      <div className="ui-page-skeleton-header-copy">
        <Skeleton className="ui-page-skeleton-title" style={bone} />
        {description ? <Skeleton.Text width="46%" /> : null}
      </div>
      {action ? <Skeleton.Button className="ui-page-skeleton-action" /> : null}
    </div>
  );
}

/** `count` metric tiles in `StatGrid`'s grid, each shaped like a `StatCard`. */
export function StatGridSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden className="ui-stat-grid">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <Skeleton.Text size="xs" width={72} />
          <Skeleton className="ui-page-skeleton-stat-value" style={bone} />
          <Skeleton.Text size="xs" width="68%" />
        </Card>
      ))}
    </div>
  );
}

/** A framed table: a header band and `rows` rows. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="ui-page-skeleton-table">
      <div className="ui-page-skeleton-thead">
        {HEAD.map((width) => (
          <Skeleton
            className="ui-page-skeleton-thead-cell"
            key={width}
            style={{ ...bone, width }}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-page-skeleton-row" key={index}>
          <div className="ui-page-skeleton-copy">
            <Skeleton.Text
              rows={2}
              width={[...lineWidths[index % lineWidths.length]]}
            />
          </div>
          <Skeleton className="ui-page-skeleton-tag" style={bone} />
          <Skeleton className="ui-page-skeleton-cell" style={bone} />
        </div>
      ))}
    </div>
  );
}
