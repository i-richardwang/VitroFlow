import type { ReactNode } from "react";

/** Title row of a page: heading, description and an action slot. */
export function PageHeader({
  action,
  description,
  title,
}: {
  /** Actions at the end of the header. */
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header-copy">
        <h1 className="ui-page-header-title">{title}</h1>
        {description ? (
          <div className="ui-page-header-description">{description}</div>
        ) : null}
      </div>
      {action ? <div className="ui-page-header-actions">{action}</div> : null}
    </div>
  );
}
