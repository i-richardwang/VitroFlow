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
  type AppNavItem,
  type AppNavLinkProps,
  matchesNavPath,
} from "../kit/AppNav";
import {
  AppShell,
  AppShellBrand,
  type AppShellLinkProps,
  AppShellTrail,
} from "../kit/AppShell";

export type Crumb = { label: string; href?: string };

const HOME = "/experiments";

function places(): AppNavItem[] {
  return [
    { href: HOME, icon: FlaskConical, label: m.nav_experiments() },
    { href: "/models", icon: Network, label: m.nav_models() },
    { href: "/datasets", icon: Images, label: m.nav_datasets() },
    { href: "/training", icon: ChartLine, label: m.nav_training() },
  ];
}

/** The settings section, which takes the sidebar's place while one of its pages is open. */
export function settingsPlaces(user: WorkbenchUser): AppNavItem[] {
  const items: AppNavItem[] = [
    { href: "/account", icon: CircleUser, label: m.nav_account() },
    { href: "/integrations", icon: KeyRound, label: m.nav_integrations() },
    { href: "/status", icon: Server, label: m.nav_workers() },
  ];
  if (isAdmin(user)) {
    items.push({ href: "/users", icon: Users, label: m.nav_users() });
  }
  return items;
}

/*
 * The router sets `aria-current="page"` on a link it counts as active, over
 * the kit's own marking; matching exactly keeps it off the ancestors a
 * breadcrumb links to.
 */
const routerLink = ({
  href,
  ...props
}: AppShellLinkProps | AppNavLinkProps | BreadcrumbLinkProps) => (
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
 * bar carrying the breadcrumb and the page's actions. A settings page swaps
 * the places for the settings section. Whether the sidebar is hidden is
 * owned by the caller so the server renders the stored choice.
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
  const settings = settingsPlaces(user);
  const inSettings = settings.some((item) =>
    matchesNavPath(pathname, item.href),
  );
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  return (
    <ActionsSlot value={actionsSlot}>
      <AppShell
        className="isolate"
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        header={
          inSettings ? (
            <AppShellTrail
              home={{ href: HOME, label: m.nav_home() }}
              title={m.nav_settings()}
              renderLink={routerLink}
            />
          ) : (
            <AppShellBrand
              href={HOME}
              logo={<BrandLogo className="size-5" />}
              title={m.app_name()}
              renderLink={routerLink}
            />
          )
        }
        navigation={
          <AppNav
            items={inSettings ? settings : places()}
            pathname={pathname}
            renderLink={routerLink}
          />
        }
        footer={account}
        breadcrumb={<Trail />}
        tools={<div ref={setActionsSlot} className="flex items-center gap-1" />}
      >
        {children}
      </AppShell>
    </ActionsSlot>
  );
}

/** The way back up to the current page; a top-level page's own header names it, so it shows no trail. */
function Trail() {
  const crumbs = trail(useMatches());
  if (crumbs.length < 2) return null;
  const items: BreadcrumbItem[] = crumbs.map((crumb, index) => ({
    href: index === crumbs.length - 1 ? undefined : crumb.href,
    label: crumb.label,
  }));
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
