import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Breadcrumbs } from "@heroui/react";
import {
  getRouteApi,
  useMatches,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { m } from "../../paraglide/messages";
import { isAdmin, type WorkbenchUser } from "../../domain/auth/schema";
import { BrandLogo } from "../BrandLogo";
import {
  AccountIcon,
  DatasetsIcon,
  ExperimentsIcon,
  KeyIcon,
  ModelsIcon,
  StatusIcon,
  TrainingIcon,
  UsersIcon,
} from "../icons";

const NAV = [
  {
    label: m.nav_group_lab,
    items: [
      {
        href: "/experiments",
        label: m.nav_experiments,
        icon: ExperimentsIcon,
        match: "experiments",
      },
    ],
  },
  {
    label: m.nav_group_model,
    items: [
      {
        href: "/models",
        label: m.nav_models,
        icon: ModelsIcon,
        match: "models",
      },
      {
        href: "/datasets",
        label: m.nav_datasets,
        icon: DatasetsIcon,
        match: "datasets",
      },
      {
        href: "/training",
        label: m.nav_training,
        icon: TrainingIcon,
        match: "training",
      },
    ],
  },
  {
    label: m.nav_group_workers,
    items: [
      {
        href: "/status",
        label: m.nav_status,
        icon: StatusIcon,
        match: "status",
      },
    ],
  },
  {
    label: m.nav_group_settings,
    items: [
      {
        href: "/account",
        label: m.nav_account,
        icon: AccountIcon,
        match: "account",
      },
      {
        href: "/integrations",
        label: m.nav_integrations,
        icon: KeyIcon,
        match: "integrations",
      },
    ],
  },
] as const;

/** Navigation only administrators see. */
const ADMIN_NAV = [
  {
    label: m.nav_group_workbench,
    items: [
      { href: "/users", label: m.nav_users, icon: UsersIcon, match: "users" },
    ],
  },
] as const;

const workbenchRoute = getRouteApi("/_workbench");

const ActionsSlot = createContext<HTMLElement | null>(null);

const AsideSlot = createContext<{
  node: HTMLElement | null;
  show: (show: boolean) => void;
} | null>(null);

export type Crumb = { label: string; href?: string; mono?: boolean };

export function ShellActions({ children }: { children: ReactNode }) {
  const slot = use(ActionsSlot);
  if (!slot) {
    return null;
  }
  return createPortal(children, slot);
}

/** AppLayout aside. Sheet below 1024px. */
export function ShellAside({ children }: { children: ReactNode }) {
  const aside = use(AsideSlot);
  if (!aside) {
    throw new Error("ShellAside requires Shell");
  }
  useLayoutEffect(() => {
    aside.show(true);
    return () => aside.show(false);
  }, [aside.show]);
  if (!aside.node) return null;
  return createPortal(children, aside.node);
}

export function Shell({
  children,
  account,
}: {
  children: ReactNode;
  account: ReactNode;
}) {
  const { user } = workbenchRoute.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [hasAside, setHasAside] = useState(false);
  const [asideNode, setAsideNode] = useState<HTMLDivElement | null>(null);
  const go = useCallback(
    (href: string) => {
      void navigate({ to: href });
    },
    [navigate],
  );
  const showAside = useCallback((show: boolean) => {
    setHasAside((current) => (current === show ? current : show));
  }, []);
  const asideSlot = useMemo(
    () => ({ node: asideNode, show: showAside }),
    [asideNode, showAside],
  );

  return (
    <AsideSlot.Provider value={asideSlot}>
      <ActionsSlot.Provider value={actionsSlot}>
        <AppLayout
          navigate={go}
          scrollMode="content"
          sidebar={
            <AppSidebar pathname={pathname} user={user} account={account} />
          }
          sidebarCollapsible="icon"
          navbar={<AppNavbar onActionsSlot={setActionsSlot} />}
          aside={
            hasAside ? (
              <div
                ref={setAsideNode}
                className="flex h-full flex-col gap-6 overflow-y-auto p-4 text-sm"
              />
            ) : undefined
          }
          asideMobile={hasAside ? "sheet" : undefined}
        >
          {children}
        </AppLayout>
      </ActionsSlot.Provider>
    </AsideSlot.Provider>
  );
}

function AppNavbar({
  onActionsSlot,
}: {
  onActionsSlot: (node: HTMLDivElement | null) => void;
}) {
  const crumbs = trail(useMatches());

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle aria-label={m.nav_toggle()} />
        <Sidebar.Trigger aria-label={m.nav_toggle()} />
        {crumbs.length > 0 ? (
          <Breadcrumbs className="min-w-0">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <Breadcrumbs.Item
                  key={`${crumb.label}:${crumb.href ?? "current"}`}
                  href={last ? undefined : crumb.href}
                  className={
                    crumb.mono
                      ? "min-w-0 font-mono no-underline"
                      : "min-w-0 no-underline"
                  }
                >
                  <span className="truncate">{crumb.label}</span>
                </Breadcrumbs.Item>
              );
            })}
          </Breadcrumbs>
        ) : null}
        <Navbar.Spacer />
        <Navbar.Content>
          <div ref={onActionsSlot} className="flex items-center gap-3" />
        </Navbar.Content>
      </Navbar.Header>
    </Navbar>
  );
}

/** The deepest settled match that declares a trail decides it. */
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
    if (!spec || match.status !== "success") {
      continue;
    }
    return spec({
      loaderData: match.loaderData,
      params: match.params as Record<string, string>,
    });
  }
  return [];
}

function AppSidebar({
  pathname,
  user,
  account,
}: {
  pathname: string;
  user: WorkbenchUser;
  account: ReactNode;
}) {
  const section = pathname.split("/")[1] || "experiments";

  return (
    <>
      <Sidebar>
        <SidebarContents section={section} user={user} account={account} />
      </Sidebar>
      <Sidebar.Mobile>
        <SidebarContents
          idPrefix="mobile-"
          section={section}
          user={user}
          account={account}
        />
      </Sidebar.Mobile>
    </>
  );
}

function SidebarContents({
  idPrefix = "",
  section,
  user,
  account,
}: {
  idPrefix?: string;
  section: string;
  user: WorkbenchUser;
  account: ReactNode;
}) {
  const groups = isAdmin(user) ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-2">
          <BrandLogo className="size-8 shrink-0" />
          <span
            className="truncate text-base font-semibold text-foreground"
            data-sidebar="label"
          >
            {m.app_name()}
          </span>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        {groups.map((group) => (
          <Sidebar.Group key={group.label()}>
            <Sidebar.GroupLabel>{group.label()}</Sidebar.GroupLabel>
            <Sidebar.Menu aria-label={group.label()}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Sidebar.MenuItem
                    key={item.href}
                    href={item.href}
                    id={`${idPrefix}${item.match}`}
                    isCurrent={section === item.match}
                    textValue={item.label()}
                  >
                    <Sidebar.MenuIcon>
                      <Icon />
                    </Sidebar.MenuIcon>
                    <Sidebar.MenuLabel>{item.label()}</Sidebar.MenuLabel>
                  </Sidebar.MenuItem>
                );
              })}
            </Sidebar.Menu>
          </Sidebar.Group>
        ))}
      </Sidebar.Content>
      <Sidebar.Footer>{account}</Sidebar.Footer>
    </>
  );
}
