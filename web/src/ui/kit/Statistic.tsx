import { Children, type CSSProperties, type ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * A page's figures. A `Statistic` is a title over a value, with an optional
 * description under the value (a denominator, a thin `Progress`) and an
 * `extra` at the end of the title row. `StatisticGroup` lays its statistics
 * out side by side, one column each, until a column would fall under 240px;
 * then the row wraps.
 */

export function StatisticGroup({ children }: { children: ReactNode }) {
  return (
    <dl
      className="ui-statistic-group"
      style={
        {
          "--ui-statistic-group-columns": Children.count(children),
        } as CSSProperties
      }
    >
      {children}
    </dl>
  );
}

export function Statistic({
  description,
  extra,
  title,
  value,
}: {
  description?: ReactNode;
  extra?: ReactNode;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="ui-statistic">
      <dt className="ui-statistic-title">{title}</dt>
      {extra != null ? <dd className="ui-statistic-extra">{extra}</dd> : null}
      <dd className="ui-statistic-body">
        <div className="ui-statistic-value">{value}</div>
        {description != null ? (
          <div className="ui-statistic-description">{description}</div>
        ) : null}
      </dd>
    </div>
  );
}

/** `count` statistics of a `StatisticGroup` while they load: a title's bone over a value's. */
export function StatisticGroupSkeleton({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      className="ui-statistic-group"
      style={{ "--ui-statistic-group-columns": count } as CSSProperties}
    >
      {Array.from(Array(count).keys(), (slot) => (
        <StatisticSkeleton key={slot} />
      ))}
    </div>
  );
}

/** One `Statistic` while it loads. */
export function StatisticSkeleton() {
  return (
    <div aria-hidden className="ui-statistic">
      <div className="ui-statistic-title">
        <Skeleton className="ui-statistic-skeleton-title" />
      </div>
      <Skeleton className="ui-statistic-skeleton-value" />
    </div>
  );
}
