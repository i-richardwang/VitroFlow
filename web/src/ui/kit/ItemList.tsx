import { Fragment, type ReactNode } from "react";
import { IconBox, type IconBoxSize } from "./IconBox";
import type { IconProps } from "./Icon";
import { Skeleton } from "./Skeleton";

/*
 * Things of one kind as rows rather than table columns. An `Item` leads with
 * an icon box, then its name with an `addon` right after it (a tag, a status
 * dot) over a line of description; `extra` sits at the end of the row, or
 * on a line under the description on a phone, and `actions` after it show
 * while the row is hovered, holds focus or has its menu open, and always on a
 * phone. A description given as a list is set with thin rules between its
 * parts.
 *
 * The list runs to the surface's edges through `--surface-gutter` and the rows'
 * hover fill stays inside it, so the icons line up with the content above.
 * `empty` is drawn in place of the list when it has no items.
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
  description,
  extra,
  icon,
  iconSize = "middle",
  title,
}: {
  actions?: ReactNode;
  addon?: ReactNode;
  description?: ReactNode | ReactNode[];
  extra?: ReactNode;
  icon: IconProps["icon"];
  iconSize?: Exclude<IconBoxSize, "small">;
  title: ReactNode;
}) {
  const parts = Array.isArray(description) ? description : [description];
  return (
    <li className="ui-item">
      <IconBox icon={icon} size={iconSize} />
      <div className="ui-item-body">
        <div className="ui-item-heading">
          <span className="ui-item-title">{title}</span>
          {addon}
        </div>
        {description != null ? (
          <div className="ui-item-description">
            {parts.map((part, index) => (
              <Fragment key={index}>
                {index > 0 ? (
                  <span aria-hidden className="ui-item-rule" />
                ) : null}
                <span>{part}</span>
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
      {extra != null ? <div className="ui-item-extra">{extra}</div> : null}
      {actions != null ? (
        <div className="ui-item-actions">{actions}</div>
      ) : null}
    </li>
  );
}

/** An `ItemList` while it loads: `rows` rows of an icon and two lines. */
export function ItemListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="ui-item-list">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-item" key={index}>
          <Skeleton className="ui-item-skeleton-icon" />
          <div className="ui-item-body">
            <Skeleton.Text width="32%" />
            <Skeleton.Text size="xs" width="48%" />
          </div>
        </div>
      ))}
    </div>
  );
}
