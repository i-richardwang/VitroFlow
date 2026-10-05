import type { ReactNode } from "react";
import type { IconProps } from "./Icon";
import { IconTile } from "./IconTile";
import { Skeleton } from "./Skeleton";

/*
 * Things of one kind as rows rather than table columns, in an outlined card.
 * An `Item` opens with an optional `icon` on a small tile beside both lines,
 * then its name with an `addon` right after it (a tag, a status),
 * under that a line of `meta` (small facts such as a time or a count), then
 * at the row's end `extra` (tags) and `actions`, which show while the row is
 * hovered, holds focus or has its menu open, and always on a phone. On a
 * phone `extra` moves to a line under the facts.
 *
 * `empty` is drawn in place of the list, in the same card, when it has no
 * items.
 */

export function ItemList({
  "aria-label": ariaLabel,
  children,
  empty,
}: {
  "aria-label": string;
  children: ReactNode;
  empty?: ReactNode;
}) {
  if (empty != null && empty !== false) {
    return <div className="ui-item-list-empty">{empty}</div>;
  }
  return (
    <ul aria-label={ariaLabel} className="ui-item-list">
      {children}
    </ul>
  );
}

export function Item({
  actions,
  addon,
  extra,
  icon,
  meta,
  title,
}: {
  actions?: ReactNode;
  addon?: ReactNode;
  extra?: ReactNode;
  icon?: IconProps["icon"];
  /** One fact, or several set side by side. */
  meta?: ReactNode | ReactNode[];
  title: ReactNode;
}) {
  const facts = meta == null ? [] : Array.isArray(meta) ? meta : [meta];
  return (
    <li className="ui-item" data-icon={icon ? "" : undefined}>
      {icon ? (
        <span className="ui-item-icon">
          <IconTile icon={icon} size="small" />
        </span>
      ) : null}
      <div className="ui-item-heading">
        <span className="ui-item-title">{title}</span>
        {addon}
      </div>
      {facts.length > 0 ? (
        <div className="ui-item-meta">
          {facts.map((fact, index) => (
            <span key={index}>{fact}</span>
          ))}
        </div>
      ) : null}
      {extra != null ? <div className="ui-item-trailing">{extra}</div> : null}
      {actions != null ? (
        <div className="ui-item-actions">{actions}</div>
      ) : null}
    </li>
  );
}

/** An `ItemList` while it loads: `rows` rows of a name over its facts, after a tile with `icon`. */
export function ItemListSkeleton({
  icon,
  rows = 3,
}: {
  icon?: boolean;
  rows?: number;
}) {
  return (
    <div aria-hidden className="ui-item-list">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-item" data-icon={icon ? "" : undefined} key={index}>
          {icon ? (
            <Skeleton className="ui-item-icon ui-item-icon-skeleton" />
          ) : null}
          <div className="ui-item-heading">
            <Skeleton.Text width="32%" />
          </div>
          <div className="ui-item-meta">
            <Skeleton.Text size="xs" width="10em" />
          </div>
        </div>
      ))}
    </div>
  );
}
