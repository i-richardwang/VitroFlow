import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { Skeleton } from "./Skeleton";

/*
 * Loading shape of a page. `PageSkeleton` is the root: it stacks its parts
 * like the page's content and announces the load in a polite live region.
 * The parts (`PageHeaderSkeleton`, `TableSkeleton`, and the skeletons kept
 * beside other components, such as `StatisticGroupSkeleton`) are
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

/**
 * A `PageHeader`; `variant`, `description` and `meta` match what it shows.
 */
export function PageHeaderSkeleton({
  description,
  meta,
  variant = "list",
}: {
  description?: boolean;
  meta?: boolean;
  variant?: "list" | "subject";
}) {
  return (
    <div aria-hidden className="ui-page-skeleton-header" data-variant={variant}>
      <Skeleton className="ui-page-skeleton-title" />
      {description ? <Skeleton.Text width="46%" /> : null}
      {meta ? <Skeleton.Text size="xs" width="16em" /> : null}
    </div>
  );
}

/** An outlined `Table`: its header band and `rows` rows in the same card. */
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
