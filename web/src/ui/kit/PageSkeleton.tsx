import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { Skeleton } from "./Skeleton";

/*
 * Loading shape of a page. `PageSkeleton` is the root: it stacks its parts
 * like the page's content and announces the load in a polite live region.
 * The parts (`PageHeaderSkeleton`, `StatStripSkeleton`, `TableSkeleton`) are
 * laid out in the order the page draws them. Bones are sized by their
 * classes.
 */

const lineWidths = ["68%", "52%", "76%", "58%"] as const;
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

/** The title row; `icon`, `description`, `meta` and `action` match what the page shows. */
export function PageHeaderSkeleton({
  action,
  description,
  icon,
  meta,
}: {
  action?: boolean;
  description?: boolean;
  icon?: boolean;
  meta?: boolean;
}) {
  return (
    <div aria-hidden className="ui-page-skeleton-header">
      <div className="ui-page-skeleton-header-main">
        {icon ? <Skeleton className="ui-page-skeleton-icon" /> : null}
        <div className="ui-page-skeleton-header-copy">
          <Skeleton className="ui-page-skeleton-title" />
          {description ? <Skeleton.Text width="46%" /> : null}
          {meta ? <Skeleton className="ui-page-skeleton-meta" /> : null}
        </div>
      </div>
      {action ? <Skeleton.Button className="ui-page-skeleton-action" /> : null}
    </div>
  );
}

/** `count` items of a `StatStrip`: a figure's bone over a label's. */
export function StatStripSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden className="ui-stat-strip">
      {Array.from({ length: count }, (_, index) => (
        <div className="ui-stat-strip-item" key={index}>
          <Skeleton className="ui-page-skeleton-stat-value" />
          <Skeleton.Text size="xs" width={64} />
        </div>
      ))}
    </div>
  );
}

/** A `Table`: its header band and `rows` rows, running to the same edges. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="ui-page-skeleton-table">
      <div className="ui-page-skeleton-thead">
        {HEAD.map((width) => (
          <Skeleton
            className="ui-page-skeleton-thead-cell"
            key={width}
            width={width}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-page-skeleton-row" key={index}>
          <div className="ui-page-skeleton-copy">
            <Skeleton.Text width={lineWidths[index % lineWidths.length]!} />
          </div>
          <Skeleton className="ui-page-skeleton-tag" />
          <Skeleton className="ui-page-skeleton-cell" />
        </div>
      ))}
    </div>
  );
}
