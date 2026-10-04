import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * Things of one kind as rows rather than table columns. An `Item` is one
 * line: its name with an `addon` right after it (a tag, a status dot), then
 * a trailing cluster at the end of the row holding `extra` (tags) and `meta`
 * (small facts such as a time or a count), then `actions`, which show while
 * the row is hovered, holds focus or has its menu open, and always on a
 * phone. On a phone the trailing cluster moves to a line under the name.
 *
 * The list runs to the surface's edges through `--surface-gutter` and the
 * rows' hover fill stays inside it, so the names line up with the content
 * above. `empty` is drawn in place of the list when it has no items.
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
  meta,
  title,
}: {
  actions?: ReactNode;
  addon?: ReactNode;
  extra?: ReactNode;
  /** One fact, or several set side by side. */
  meta?: ReactNode | ReactNode[];
  title: ReactNode;
}) {
  const facts = meta == null ? [] : Array.isArray(meta) ? meta : [meta];
  return (
    <li className="ui-item">
      <div className="ui-item-heading">
        <span className="ui-item-title">{title}</span>
        {addon}
      </div>
      {extra != null || facts.length > 0 ? (
        <div className="ui-item-trailing">
          {extra}
          {facts.map((fact, index) => (
            <span className="ui-item-meta" key={index}>
              {fact}
            </span>
          ))}
        </div>
      ) : null}
      {actions != null ? (
        <div className="ui-item-actions">{actions}</div>
      ) : null}
    </li>
  );
}

/** An `ItemList` while it loads: `rows` rows of a name and its meta. */
export function ItemListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="ui-item-list">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-item" key={index}>
          <div className="ui-item-heading">
            <Skeleton.Text width="32%" />
          </div>
          <div className="ui-item-trailing">
            <Skeleton.Text size="xs" width="6em" />
          </div>
        </div>
      ))}
    </div>
  );
}
