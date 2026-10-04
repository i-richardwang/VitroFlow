import type { ReactNode } from "react";

import { PageHeader } from "./kit/PageHeader";
import { Skeleton } from "./kit/Skeleton";

/** A document page in the shell's card: a header row, then its sections. */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} action={actions} />
      {children}
    </>
  );
}

/** A titled part of a document page; `id` makes it a link target. */
export function PageSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** A `PageSection` while it loads: the heading's bone above the content's. */
export function PageSectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <section aria-hidden className="flex flex-col gap-3">
      <Skeleton.Text size="lg" width="8em" />
      {children}
    </section>
  );
}
