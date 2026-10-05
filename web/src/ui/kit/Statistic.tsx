import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * The one figure a page leads with, on a band of fill: the value large over
 * its title, a description beside the title, and a small chart or progress
 * as `aside` at the band's end.
 */
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
