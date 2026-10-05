import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { m } from "../paraglide/messages";
import { BackLink } from "./kit/BackLink";
import { PageHeader } from "./kit/PageHeader";
import { PageSkeleton } from "./kit/PageSkeleton";
import { Skeleton } from "./kit/Skeleton";
import { useCrumbs } from "./shell/crumbs";

/* A document page runs the card's full width; its parts are 24px apart. */
const COLUMN = "flex w-full flex-col gap-6 max-mobile:gap-4";

/**
 * A document page in the shell's card, under a `PageHeader` that carries the
 * page's `action`. A list page names a kind of thing, with a `description`;
 * a `subject` page is about one thing and adds its `status` and `meta`. A
 * page below another opens with a link back to the page above it, from the
 * route's crumbs.
 */
export function Page({
  title,
  subject = false,
  description,
  status,
  meta,
  action,
  children,
}: {
  title: string;
  subject?: boolean;
  description?: ReactNode;
  /** The subject's state, right after the title. */
  status?: ReactNode;
  /** Facts about the subject under the description. */
  meta?: ReactNode[];
  /** Commands at the header's end: at most one primary button, then a menu. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const parent = useCrumbs().at(-2);
  return (
    <div className={COLUMN}>
      <PageHeader
        back={
          parent?.href ? (
            <BackLink render={<Link to={parent.href} />}>
              {m.nav_back_to({ page: parent.label })}
            </BackLink>
          ) : undefined
        }
        variant={subject ? "subject" : "list"}
        title={title}
        description={description}
        status={status}
        meta={meta}
        actions={action}
      />
      {children}
    </div>
  );
}

/** A `Page` while it loads, in the same column. */
export function PageColumnSkeleton({ children }: { children: ReactNode }) {
  return (
    <PageSkeleton>
      <div className={COLUMN}>{children}</div>
    </PageSkeleton>
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
      <Skeleton.Text width="8em" />
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

/** The title block of a settings page, with `extra` at its end, ruled off from the content. */
function SettingsHeader({
  title,
  description,
  extra,
}: {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description ? (
            <div className="text-fg-secondary">{description}</div>
          ) : null}
        </div>
        {extra != null ? (
          <div className="flex flex-none items-center gap-2 text-fg-secondary">
            {extra}
          </div>
        ) : null}
      </div>
      <hr className="border-border-secondary" />
    </div>
  );
}

/**
 * A settings page: the reader's own account, keys and connections, or the
 * workspace's people and machines. Its header names it and carries `extra`,
 * such as a count and the page's one command; the content is a column of
 * `SettingsGroup`s, or for a page that is one roster, the roster itself.
 */
export function SettingsPage({
  title,
  description,
  extra,
  children,
}: {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={SETTINGS_COLUMN}>
      <SettingsHeader title={title} description={description} extra={extra} />
      {children}
    </div>
  );
}

/** A `SettingsPage` while it loads: its header's bones, then `children` such as `SettingsGroupSkeleton`s. */
export function SettingsPageSkeleton({ children }: { children: ReactNode }) {
  return (
    <PageSkeleton>
      <div className={SETTINGS_COLUMN}>
        <div aria-hidden className="flex flex-col gap-6 pt-3">
          <Skeleton className="my-1 h-6 w-32" />
          <hr className="border-border-secondary" />
        </div>
        {children}
      </div>
    </PageSkeleton>
  );
}
