import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * The one figure a page or a side panel leads with, on a band of fill: the
 * value large over its title, a line of `facts` beside the title, and its
 * progress or chart as `aside` at the band's end. `compact` is the band a
 * side panel leads with.
 */
export function StatisticHero({
  aside,
  facts,
  size = "default",
  title,
  value,
}: {
  aside?: ReactNode;
  facts?: ReactNode[];
  size?: "default" | "compact";
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <section className="ui-statistic-hero" data-size={size}>
      <div className="ui-statistic-hero-main">
        <div className="ui-statistic-hero-value">{value}</div>
        <div className="ui-statistic-hero-title">
          <span>{title}</span>
          {facts?.map((fact, index) => (
            <span className="ui-statistic-hero-fact" key={index}>
              {fact}
            </span>
          ))}
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
        <Skeleton.Text width="8em" />
      </div>
    </div>
  );
}
