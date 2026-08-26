import type { ReactNode } from "react";

export function Page({
  breadcrumbs,
  title,
  titleClassName,
  description,
  children,
}: {
  breadcrumbs?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      {breadcrumbs}
      <h1
        className={[
          "text-xl font-semibold tracking-tight",
          breadcrumbs ? "mt-3" : "",
          titleClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-1 text-sm text-muted">{description}</p>
      ) : null}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </main>
  );
}
