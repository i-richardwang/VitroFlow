import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/*
 * A group of a settings page: a tray with the group's heading, an optional
 * description and an `extra` at its end (a count, a small button), and an
 * inner panel holding the group's content. The panel's content runs to its
 * edges: `SettingsRow`s, a table, a list.
 *
 * `SettingsRow` is one setting in the panel: a label column, the value after
 * it and an optional action at the end of the row, rows ruled apart.
 */
export function SettingsGroup({
  children,
  description,
  extra,
  id,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  /** Makes the group a link target. */
  id?: string;
  title: string;
}) {
  return (
    <section className="ui-settings-group" id={id}>
      <header className="ui-settings-group-header">
        <div className="ui-settings-group-copy">
          <h2 className="ui-settings-group-title">{title}</h2>
          {description ? (
            <div className="ui-settings-group-description">{description}</div>
          ) : null}
        </div>
        {extra != null ? (
          <div className="ui-settings-group-extra">{extra}</div>
        ) : null}
      </header>
      <div className="ui-settings-group-panel">{children}</div>
    </section>
  );
}

export function SettingsRow({
  action,
  children,
  label,
}: {
  action?: ReactNode;
  children?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="ui-settings-row">
      <div className="ui-settings-row-label">{label}</div>
      <div className="ui-settings-row-value">{children}</div>
      {action != null ? (
        <div className="ui-settings-row-action">{action}</div>
      ) : null}
    </div>
  );
}

/**
 * A `SettingsGroup` while it loads: the heading's bone over the panel's
 * content in its own shape (a `TableSkeleton`, an `ItemListSkeleton`), or
 * over `rows` setting rows.
 */
export function SettingsGroupSkeleton({
  children,
  rows = 2,
}: {
  children?: ReactNode;
  rows?: number;
}) {
  return (
    <div aria-hidden className="ui-settings-group">
      <div className="ui-settings-group-header">
        <Skeleton.Text size="lg" width="8em" />
      </div>
      <div className="ui-settings-group-panel">
        {children ??
          Array.from({ length: rows }, (_, index) => (
            <div className="ui-settings-row" key={index}>
              <div className="ui-settings-row-label">
                <Skeleton.Text width="5em" />
              </div>
              <div className="ui-settings-row-value">
                <Skeleton.Text width="40%" />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
