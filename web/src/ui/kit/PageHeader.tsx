import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * The title block at the top of a page's content, with the page's commands
 * at its end. A `list` page names a kind of thing: a 30px title and a line
 * of description. A `subject` page is about one thing: a 24px title followed
 * by the subject's `status`, its description, and a line of `meta` facts.
 * A page below another opens with a `back` link (a `BackLink`) above it all.
 */
export function PageHeader({
  actions,
  back,
  description,
  meta,
  status,
  title,
  variant = "list",
}: {
  /** At most one primary button, then a menu. */
  actions?: ReactNode;
  back?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode[];
  status?: ReactNode;
  title: ReactNode;
  variant?: "list" | "subject";
}) {
  const header = (
    <div className={cn("ui-page-header", `ui-page-header-${variant}`)}>
      <div className="ui-page-header-main">
        <div className="ui-page-header-heading">
          <h1 className="ui-page-header-title">{title}</h1>
          {status}
        </div>
        {description ? (
          <div className="ui-page-header-description">{description}</div>
        ) : null}
        {meta?.length ? (
          <ul className="ui-page-header-meta">
            {meta.map((item, index) => (
              <li className="ui-page-header-meta-item" key={index}>
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {actions != null ? (
        <div className="ui-page-header-actions">{actions}</div>
      ) : null}
    </div>
  );
  if (back == null) return header;
  return (
    <div className="ui-page-header-stack">
      {back}
      {header}
    </div>
  );
}
