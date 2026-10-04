import type { ReactNode } from "react";
import { IconBox } from "./IconBox";
import type { IconProps } from "./Icon";

/*
 * Title row of a page. The heading can lead with an `icon` that marks what
 * the page is about and be followed on its line by a `status`; under it come
 * a description and a row of `meta` facts, each in a small chip. Actions sit
 * at the end of the row.
 */
export function PageHeader({
  action,
  description,
  icon,
  meta,
  status,
  title,
}: {
  /** Actions at the end of the header. */
  action?: ReactNode;
  description?: ReactNode;
  icon?: IconProps["icon"];
  meta?: ReactNode[];
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header-main">
        {icon ? <IconBox icon={icon} primary /> : null}
        <div className="ui-page-header-copy">
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
      </div>
      {action ? <div className="ui-page-header-actions">{action}</div> : null}
    </div>
  );
}
