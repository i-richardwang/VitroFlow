import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Breadcrumbs, Button } from "@heroui/react";
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
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { BrandLogo } from "./BrandLogo";
import {
  DatasetsIcon,
  ExperimentsIcon,
  LogoutIcon,
  StatusIcon,
  TrainingIcon,
} from "./icons";

const NAV = [
  {
    href: "/experiments",
    label: "Experiments",
    icon: ExperimentsIcon,
    match: "experiments",
  },
  {
    href: "/datasets",
    label: "Datasets",
    icon: DatasetsIcon,
    match: "datasets",
  },
  {
    href: "/training",
    label: "Training",
    icon: TrainingIcon,
    match: "training",
  },
  { href: "/status", label: "Status", icon: StatusIcon, match: "status" },
] as const;

const workbenchRoute = getRouteApi("/_workbench");

const ActionsSlot = createContext<HTMLElement | null>(null);

/** One step in the navbar trail. Leaf routes declare the trail they sit on. */
export type Crumb = { label: string; href?: string; mono?: boolean };

/** Puts a screen's actions in the navbar. The layout owns the slot. */
export function ShellActions({ children }: { children: ReactNode }) {
  const slot = use(ActionsSlot);
  if (!slot) {
    return null;
  }
  return createPortal(children, slot);
}

/**
 * Navigation, breadcrumbs, and the main column. Document screens and
 * photograph screens both fill the column.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { signedIn } = workbenchRoute.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const go = useCallback(
    (href: string) => {
      void navigate({ to: href });
    },
    [navigate],
  );

  return (
    <ActionsSlot.Provider value={actionsSlot}>
      <AppLayout
        navigate={go}
        scrollMode="content"
        sidebar={<AppSidebar pathname={pathname} signedIn={signedIn} />}
        sidebarCollapsible="icon"
        navbar={<AppNavbar onActionsSlot={setActionsSlot} />}
      >
        {children}
      </AppLayout>
    </ActionsSlot.Provider>
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
        <AppLayout.MenuToggle />
        <Sidebar.Trigger aria-label="Toggle navigation" />
        {crumbs.length > 0 ? (
          <Breadcrumbs className="min-w-0">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <Breadcrumbs.Item
                  key={`${crumb.label}:${crumb.href ?? "current"}`}
                  href={last ? undefined : crumb.href}
                  className={`min-w-0 no-underline ${last ? "font-semibold" : "text-muted"} ${crumb.mono ? "font-mono" : ""}`}
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

function trail(
  matches: ReadonlyArray<{
    loaderData: unknown;
    params: unknown;
    staticData: {
      crumbs?:
        | Crumb[]
        | ((match: {
            loaderData: unknown;
            params: Record<string, string>;
          }) => Crumb[]);
    };
  }>,
): Crumb[] {
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const spec = match.staticData.crumbs;
    if (!spec) {
      continue;
    }
    if (typeof spec !== "function") {
      return spec;
    }
    if (match.loaderData === undefined) {
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
  signedIn,
}: {
  pathname: string;
  signedIn: boolean;
}) {
  const section = pathname.split("/")[1] || "experiments";

  return (
    <>
      <Sidebar>
        <SidebarContents section={section} signedIn={signedIn} />
      </Sidebar>
      <Sidebar.Mobile>
        <SidebarContents
          idPrefix="mobile-"
          section={section}
          signedIn={signedIn}
        />
      </Sidebar.Mobile>
    </>
  );
}

function SidebarContents({
  idPrefix = "",
  section,
  signedIn,
}: {
  idPrefix?: string;
  section: string;
  signedIn: boolean;
}) {
  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-1">
          <BrandLogo className="size-10 shrink-0" />
          <div className="min-w-0" data-sidebar="label">
            <div className="truncate text-sm font-semibold text-foreground">
              VitroFlow
            </div>
            <div className="truncate text-xs text-muted">Detection review</div>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="Workbench">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Sidebar.MenuItem
                  key={item.href}
                  href={item.href}
                  id={`${idPrefix}${item.match}`}
                  isCurrent={section === item.match}
                  textValue={item.label}
                >
                  <Sidebar.MenuIcon>
                    <Icon />
                  </Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              );
            })}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      {signedIn && (
        <Sidebar.Footer>
          <form method="post" action="/logout">
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start"
            >
              <LogoutIcon />
              <span data-sidebar="label">Sign out</span>
            </Button>
          </form>
        </Sidebar.Footer>
      )}
    </>
  );
}
