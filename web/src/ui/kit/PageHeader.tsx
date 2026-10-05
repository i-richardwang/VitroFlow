import type { ReactNode } from "react";
import { cn } from "./cn";
import type { IconProps } from "./Icon";
import { IconTile } from "./IconTile";

/*
 * The title block at the top of a page's content, with the page's commands
 * at its end. A `list` page names a kind of thing: a 30px title and a line
 * of description. A `subject` page is about one thing: a 24px title followed
 * by the subject's `status`, its description, and a line of `meta` facts.
 * A subject's `icon` stands on a 40px tile before the title block, the same
 * mark its card carries in the list. A page below another opens with a
 * `back` link (a `BackLink`) above it all.
 */
export function PageHeader({
  actions,
  back,
  description,
  icon,
  meta,
  status,
  title,
  variant = "list",
}: {
  /** At most one primary button, then a menu. */
  actions?: ReactNode;
  back?: ReactNode;
  description?: ReactNode;
  icon?: IconProps["icon"];
  meta?: ReactNode[];
  status?: ReactNode;
  title: ReactNode;
  variant?: "list" | "subject";
}) {
  const main = (
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
  );
  const header = (
    <div className={cn("ui-page-header", `ui-page-header-${variant}`)}>
      {icon ? (
        <div className="ui-page-header-identity">
          <IconTile icon={icon} />
          {main}
        </div>
      ) : (
        main
      )}
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
