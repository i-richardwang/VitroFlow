import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import {
  ChartLine,
  CircleUser,
  FlaskConical,
  Images,
  KeyRound,
  Network,
  Server,
  Users,
} from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isAdmin, type WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import { BrandLogo } from "../BrandLogo";
import {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbLinkProps,
} from "../kit/Breadcrumb";
import {
  AppNav,
  type AppNavGroup,
  type AppNavLinkProps,
  matchesNavPath,
} from "../kit/AppNav";
import {
  AppShell,
  AppShellBrand,
  type AppShellBrandLinkProps,
} from "../kit/AppShell";

export type Crumb = { label: string; href?: string; mono?: boolean };

function navigation(user: WorkbenchUser): AppNavGroup[] {
  const groups: AppNavGroup[] = [
    {
      key: "lab",
      label: m.nav_group_lab(),
      items: [
        {
          href: "/experiments",
          icon: FlaskConical,
          label: m.nav_experiments(),
        },
      ],
    },
    {
      key: "model",
      label: m.nav_group_model(),
      items: [
        { href: "/models", icon: Network, label: m.nav_models() },
        { href: "/datasets", icon: Images, label: m.nav_datasets() },
        { href: "/training", icon: ChartLine, label: m.nav_training() },
      ],
    },
    {
      key: "workers",
      label: m.nav_group_workers(),
      items: [{ href: "/status", icon: Server, label: m.nav_status() }],
    },
    {
      key: "settings",
      label: m.nav_group_settings(),
      items: [
        { href: "/account", icon: CircleUser, label: m.nav_account() },
        {
          href: "/integrations",
          icon: KeyRound,
          label: m.nav_integrations(),
        },
      ],
    },
  ];
  if (isAdmin(user)) {
    groups.push({
      key: "administration",
      label: m.nav_group_administration(),
      items: [{ href: "/users", icon: Users, label: m.nav_users() }],
    });
  }
  return groups;
}

/*
 * The router sets `aria-current="page"` on a link it counts as active, over
 * the kit's own marking; matching exactly keeps it off the ancestors a
 * breadcrumb or navigation group links to.
 */
const routerLink = ({
  href,
  ...props
}: AppShellBrandLinkProps | AppNavLinkProps | BreadcrumbLinkProps) => (
  <Link {...props} to={href} activeOptions={{ exact: true }} />
);

const ActionsSlot = createContext<HTMLElement | null>(null);

/** Page actions rendered at the end of the shell's top bar. */
export function ShellActions({ children }: { children: ReactNode }) {
  const slot = use(ActionsSlot);
  if (!slot) return null;
  return createPortal(children, slot);
}

/**
 * The signed-in frame: navigation on the canvas, the page in a card with a top
 * bar carrying the breadcrumb and the page's actions. The rail's collapsed
 * state is owned by the caller so the server renders the stored choice.
 */
export function Shell({
  children,
  account,
  user,
  collapsed,
  onCollapsedChange,
}: {
  children: ReactNode;
  account: ReactNode;
  user: WorkbenchUser;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const groups = navigation(user);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  return (
    <ActionsSlot value={actionsSlot}>
      <AppShell
        className="isolate"
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        brand={
          <AppShellBrand
            href="/experiments"
            logo={<BrandLogo className="size-6" />}
            title={m.app_name()}
            renderLink={routerLink}
          />
        }
        navigation={
          <AppNav groups={groups} pathname={pathname} renderLink={routerLink} />
        }
        footer={account}
        breadcrumb={<Trail group={sectionGroup(groups, pathname)} />}
        tools={<div ref={setActionsSlot} className="flex items-center gap-2" />}
      >
        {children}
      </AppShell>
    </ActionsSlot>
  );
}

/** The navigation group holding the current page; it leads the breadcrumb. */
function sectionGroup(
  groups: AppNavGroup[],
  pathname: string,
): string | undefined {
  return groups.find((group) =>
    group.items.some((item) => matchesNavPath(pathname, item.href)),
  )?.label;
}

function Trail({ group }: { group?: string }) {
  const crumbs = trail(useMatches());
  if (crumbs.length === 0) return null;
  const items: BreadcrumbItem[] = crumbs.map((crumb, index) => ({
    href: index === crumbs.length - 1 ? undefined : crumb.href,
    label: crumb.mono ? (
      <span className="font-mono">{crumb.label}</span>
    ) : (
      crumb.label
    ),
  }));
  if (group) items.unshift({ label: group, optional: true });
  return <Breadcrumb items={items} renderLink={routerLink} />;
}

function trail(
  matches: ReadonlyArray<{
    status: string;
    loaderData: unknown;
    params: unknown;
    staticData: {
      crumbs?: (match: {
        loaderData: unknown;
        params: Record<string, string>;
      }) => Crumb[];
    };
  }>,
): Crumb[] {
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const spec = match.staticData.crumbs;
    if (!spec || match.status !== "success") continue;
    return spec({
      loaderData: match.loaderData,
      params: match.params as Record<string, string>,
    });
  }
  return [];
}
