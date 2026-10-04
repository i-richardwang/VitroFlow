import type { ReactNode } from "react";

/*
 * A titled region of a document page: a thin border, a header bar with a
 * small title and an optional `extra` at its end (a legend, a count, a small
 * button), and a body padded 20px that stacks its content 20px apart.
 */
export function Panel({
  children,
  extra,
  title,
}: {
  children: ReactNode;
  extra?: ReactNode;
  title: string;
}) {
  return (
    <section className="ui-panel">
      <header className="ui-panel-header">
        <h3 className="ui-panel-title">{title}</h3>
        {extra != null ? <div className="ui-panel-extra">{extra}</div> : null}
      </header>
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}
