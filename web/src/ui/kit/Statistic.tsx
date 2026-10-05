import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * A page's figures. `StatisticGroup` is one strip of them under the page
 * header, 24px apart with a hairline between: each `Statistic` is its value
 * (20px, 600, tabular figures) over a small tertiary title, and an optional
 * description under the title.
 *
 * `StatisticHero` is the one figure a page leads with, on a band of fill:
 * the value large over its title, a status or description beside the title,
 * and a small chart or progress as `aside` at the band's end.
 */

export function StatisticGroup({ children }: { children: ReactNode }) {
  return <dl className="ui-statistic-group">{children}</dl>;
}

export function Statistic({
  description,
  title,
  value,
}: {
  description?: ReactNode;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="ui-statistic">
      <dd className="ui-statistic-value">{value}</dd>
      <dt className="ui-statistic-title">{title}</dt>
      {description != null ? (
        <dd className="ui-statistic-description">{description}</dd>
      ) : null}
    </div>
  );
}

export function StatisticHero({
  aside,
  description,
  title,
  value,
}: {
  aside?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <section className="ui-statistic-hero">
      <div className="ui-statistic-hero-main">
        <div className="ui-statistic-hero-value">{value}</div>
        <div className="ui-statistic-hero-title">
          <span>{title}</span>
          {description != null ? (
            <span className="ui-statistic-hero-description">{description}</span>
          ) : null}
        </div>
      </div>
      {aside != null ? (
        <div className="ui-statistic-hero-aside">{aside}</div>
      ) : null}
    </section>
  );
}

/** `count` statistics of a `StatisticGroup` while they load: a value's bone over a title's. */
export function StatisticGroupSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden className="ui-statistic-group">
      {Array.from(Array(count).keys(), (slot) => (
        <div className="ui-statistic" key={slot}>
          <Skeleton className="ui-statistic-skeleton-value" />
          <Skeleton className="ui-statistic-skeleton-title" />
        </div>
      ))}
    </div>
  );
}

/** A `StatisticHero` while it loads. */
export function StatisticHeroSkeleton() {
  return (
    <div aria-hidden className="ui-statistic-hero">
      <div className="ui-statistic-hero-main">
        <Skeleton className="ui-statistic-skeleton-hero" />
        <Skeleton className="ui-statistic-skeleton-title" />
      </div>
    </div>
  );
}
