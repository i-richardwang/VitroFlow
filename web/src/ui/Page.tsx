import type { ReactNode } from "react";

import type { IconProps } from "./kit/Icon";
import { PageHeader } from "./kit/PageHeader";
import { PageSkeleton } from "./kit/PageSkeleton";
import { Skeleton } from "./kit/Skeleton";

/** A document page in the shell's card: a header row, then its sections. */
export function Page({
  title,
  description,
  icon,
  status,
  meta,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Marks what the page is about, before the title. */
  icon?: IconProps["icon"];
  /** The subject's state, right after the title. */
  status?: ReactNode;
  /** Facts about the subject under the description, each in a chip. */
  meta?: ReactNode[];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        status={status}
        meta={meta}
        action={action}
      />
      {children}
    </>
  );
}

/**
 * A titled part of a document page; `id` makes it a link target. `extra`
 * sits at the end of the heading row: a count, or a small button.
 */
export function PageSection({
  id,
  title,
  description,
  extra,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? (
            <div className="text-sm text-fg-secondary">{description}</div>
          ) : null}
        </div>
        {extra != null ? (
          <div className="flex flex-none items-center gap-2">{extra}</div>
        ) : null}
      </div>
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

/*
 * The reading column of a settings page: at most 1024px wide and centered,
 * groups 36px apart, and room under the last group (with the card's own
 * padding, 128px).
 */
const SETTINGS_COLUMN = "mx-auto flex w-full max-w-5xl flex-col gap-9 pb-26";

/**
 * A settings page: the reader's own account, keys and connections, or the
 * workspace's people and machines. The breadcrumb names it, so the title is
 * only announced; the content is a column of `SettingsGroup`s.
 */
export function SettingsPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={SETTINGS_COLUMN}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}

/** A `SettingsPage` while it loads, holding `SettingsGroupSkeleton`s. */
export function SettingsPageSkeleton({ children }: { children: ReactNode }) {
  return (
    <PageSkeleton>
      <div className={SETTINGS_COLUMN}>{children}</div>
    </PageSkeleton>
  );
}
