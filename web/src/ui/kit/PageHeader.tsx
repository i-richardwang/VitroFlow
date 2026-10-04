import type { ReactNode } from "react";

/*
 * The title block of a page about one subject: the title, followed on its
 * line by the subject's `status`; under it a description and a row of `meta`
 * facts, each in a small chip. Commands live in the shell's top bar.
 */
export function PageHeader({
  description,
  meta,
  status,
  title,
}: {
  description?: ReactNode;
  meta?: ReactNode[];
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="ui-page-header">
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
}
