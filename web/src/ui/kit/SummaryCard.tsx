import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ArrowRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Icon, type IconProps } from "./Icon";
import { IconTile } from "./IconTile";
import { Skeleton } from "./Skeleton";

/*
 * Things a reader opens one at a time, laid out as cards: columns at least
 * 480px wide, 20px apart, one column on a phone.
 */
export function CardGrid({
  "aria-label": ariaLabel,
  children,
  size = "large",
}: {
  "aria-label": string;
  children: ReactNode;
  /** `small` packs compact `RowCard`s. */
  size?: "small" | "large";
}) {
  return (
    <ul aria-label={ariaLabel} className="ui-card-grid" data-size={size}>
      {children}
    </ul>
  );
}

/*
 * One thing at a glance, linking to its page: its icon tile, its name
 * (16px, 600) over a line of facts, an arrow at the end of that row; then
 * `children`, usually a `SummaryCardBand`, and at the foot `footer`, usually
 * `SummaryCardStats` over a line of tags, 16px apart. `render` is the link, a router `<Link>`; the name and
 * the arrow both follow it, the arrow hidden from assistive technology.
 */
export function SummaryCard({
  children,
  description,
  footer,
  icon,
  render,
  title,
}: {
  children?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  icon: IconProps["icon"];
  render: ReactElement;
  title: ReactNode;
}) {
  const name = useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { className: "ui-summary-card-name" },
      { children: title },
    ),
    render,
  });
  const arrow = useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { "aria-hidden": true, className: "ui-summary-card-arrow", tabIndex: -1 },
      { children: <Icon icon={ArrowRight} size={16} /> },
    ),
    render,
  });
  return (
    <li className="ui-summary-card">
      <div className="ui-summary-card-body">
        <div className="ui-summary-card-identity">
          <IconTile icon={icon} />
          <div className="ui-summary-card-heading">
            {name}
            {description != null ? (
              <span className="ui-summary-card-description">{description}</span>
            ) : null}
          </div>
          {arrow}
        </div>
        {children}
      </div>
      {footer != null ? (
        <div className="ui-summary-card-foot">{footer}</div>
      ) : null}
    </li>
  );
}

/*
 * The card's headline, on a band of fill: `metric` holds a figure and what
 * it measures, with a small chart as `aside` at its end (under it on a
 * phone); `empty`, dashed, says what is missing.
 */
export function SummaryCardBand({
  aside,
  children,
  variant = "metric",
}: {
  aside?: ReactNode;
  children: ReactNode;
  variant?: "metric" | "empty";
}) {
  return (
    <div className="ui-summary-card-band" data-variant={variant}>
      {children}
      {aside != null ? (
        <div className="ui-summary-card-band-aside">{aside}</div>
      ) : null}
    </div>
  );
}

/** A figure in the band: the value over its label, with a status after the label. */
export function SummaryCardMetric({
  label,
  status,
  value,
}: {
  label: ReactNode;
  status?: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="ui-summary-card-metric">
      <span className="ui-summary-card-metric-value">{value}</span>
      <span className="ui-summary-card-metric-label">
        {label}
        {status}
      </span>
    </div>
  );
}

/** Counts along the card's foot, each a figure over its label, divided by hairlines. */
export function SummaryCardStats({
  items,
}: {
  items: { label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="ui-summary-card-stats">
      {items.map((item, index) => (
        <div className="ui-summary-card-stat" key={index}>
          <dd>{item.value}</dd>
          <dt>{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/*
 * A compact link to one thing in a `CardGrid size="small"`: a small icon
 * tile, the name (500) over one line of facts (12px, secondary).
 */
export function RowCard({
  description,
  icon,
  render,
  title,
}: {
  description?: ReactNode;
  icon: IconProps["icon"];
  render: ReactElement;
  title: ReactNode;
}) {
  const link = useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      { className: "ui-row-card" },
      {
        children: (
          <>
            <IconTile icon={icon} size="small" />
            <span className="ui-row-card-text">
              <span className="ui-row-card-name">{title}</span>
              {description != null ? (
                <span className="ui-row-card-description">{description}</span>
              ) : null}
            </span>
          </>
        ),
      },
    ),
    render,
  });
  return <li className="ui-row-card-item">{link}</li>;
}

/** A `CardGrid` while it loads: `SummaryCard`s, or `RowCard`s when `small`. */
export function CardGridSkeleton({
  cards = 2,
  size = "large",
}: {
  cards?: number;
  size?: "small" | "large";
}) {
  return (
    <div aria-hidden className="ui-card-grid" data-size={size}>
      {Array.from({ length: cards }, (_, index) =>
        size === "small" ? (
          <div className="ui-row-card" key={index}>
            <Skeleton className="ui-row-card-skeleton-tile" />
            <span className="ui-row-card-text">
              <Skeleton.Text width="8em" />
              <Skeleton.Text size="xs" width="14em" />
            </span>
          </div>
        ) : (
          <div className="ui-summary-card" key={index}>
            <div className="ui-summary-card-identity">
              <Skeleton className="ui-summary-card-skeleton-tile" />
              <div className="ui-summary-card-heading">
                <Skeleton.Text size="lg" width="10em" />
                <Skeleton.Text size="xs" width="14em" />
              </div>
            </div>
            <Skeleton className="ui-summary-card-skeleton-band" />
          </div>
        ),
      )}
    </div>
  );
}
