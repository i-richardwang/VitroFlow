import { Link, useRouterState } from "@tanstack/react-router";
import {
  Beaker,
  CircleUser,
  FlaskConical,
  KeyRound,
  Network,
  Server,
  Users,
} from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isAdmin, type WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import { useCrumbs } from "./crumbs";
import { ColorSchemeMenu } from "../Preferences";
import {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbLinkProps,
} from "../kit/Breadcrumb";
import {
  AppNav,
  type AppNavGroup,
  type AppNavItem,
  type AppNavLinkProps,
  matchesNavPath,
} from "../kit/AppNav";
import {
  AppShell,
  type AppShellLinkProps,
  AppShellTrail,
} from "../kit/AppShell";

const HOME = "/experiments";

function places(): AppNavItem[] {
  return [
    { href: HOME, icon: FlaskConical, label: m.nav_experiments() },
    { href: "/models", icon: Network, label: m.nav_models() },
  ];
}

/** The experiments, each a place of its own under the main ones. */
function experimentGroup(
  experiments: { id: string; name: string }[],
): AppNavGroup {
  return {
    key: "experiments",
    label: m.nav_experiments(),
    empty: m.experiments_empty(),
    items: experiments.map((experiment) => ({
      href: `/experiments/${experiment.id}`,
      icon: Beaker,
      label: experiment.name,
    })),
  };
}

/** The settings section, which takes the sidebar's place while one of its pages is open. */
function settingsPlaces(user: WorkbenchUser): AppNavItem[] {
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

const TopBarSlots = createContext<{
  actions: HTMLElement | null;
  trail: HTMLElement | null;
}>({ actions: null, trail: null });

/** A workbench's commands, at the end of the shell's top bar. */
export function ShellActions({ children }: { children: ReactNode }) {
  const slot = use(TopBarSlots).actions;
  if (!slot) return null;
  return createPortal(children, slot);
}

/**
 * The breadcrumb, at the start of the shell's top bar, for a workbench,
 * which fills the card and has no header of its own; a document page shows
 * a back link above its title instead.
 */
export function ShellTrail() {
  const slot = use(TopBarSlots).trail;
  if (!slot) return null;
  return createPortal(<Trail />, slot);
}

/**
 * The signed-in frame: navigation on the canvas, the page in a card whose
 * top bar shows only when it has something to hold: the sidebar's toggle
 * while the sidebar is hidden, and a workbench's breadcrumb and commands. The sidebar opens with
 * the signed-in person, lists the places and then the experiments, and ends
 * with the color scheme. A settings page swaps the person and
 * the places for a trail home and the settings section. Whether the sidebar
 * is hidden is owned by the caller so the server renders the stored choice.
 */
export function Shell({
  children,
  account,
  experiments,
  user,
  collapsed,
  onCollapsedChange,
}: {
  children: ReactNode;
  account: ReactNode;
  experiments: { id: string; name: string }[];
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
  const [trailSlot, setTrailSlot] = useState<HTMLDivElement | null>(null);

  return (
    <TopBarSlots value={{ actions: actionsSlot, trail: trailSlot }}>
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
            account
          )
        }
        navigation={
          <AppNav
            items={inSettings ? settings : places()}
            groups={inSettings ? [] : [experimentGroup(experiments)]}
            pathname={pathname}
            renderLink={routerLink}
          />
        }
        footer={<ColorSchemeMenu size="middle" />}
        breadcrumb={<div ref={setTrailSlot} className="contents" />}
        tools={<div ref={setActionsSlot} className="flex items-center gap-1" />}
      >
        {children}
      </AppShell>
    </TopBarSlots>
  );
}

/** The way back up to the current page. */
function Trail() {
  const crumbs = useCrumbs();
  if (crumbs.length < 2) return null;
  const items: BreadcrumbItem[] = crumbs.map((crumb, index) => ({
    href: index === crumbs.length - 1 ? undefined : crumb.href,
    label: crumb.label,
  }));
  return <Breadcrumb items={items} renderLink={routerLink} />;
}
