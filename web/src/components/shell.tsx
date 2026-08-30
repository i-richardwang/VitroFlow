import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Breadcrumbs, Button } from "@heroui/react";
import { useMatch, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { trainingRunLabel } from "../training/schema";
import { BrandLogo } from "./BrandLogo";
import {
  DatasetsIcon,
  ExperimentsIcon,
  LogoutIcon,
  StatusIcon,
  TrainingIcon,
} from "./icons";

const NAV = [
  { href: "/", label: "Datasets", icon: DatasetsIcon, match: "datasets" },
  {
    href: "/training",
    label: "Training",
    icon: TrainingIcon,
    match: "training",
  },
  {
    href: "/experiments",
    label: "Experiments",
    icon: ExperimentsIcon,
    match: "experiments",
  },
  { href: "/status", label: "Status", icon: StatusIcon, match: "status" },
] as const;

const NavbarEndContext = createContext<HTMLElement | null>(null);

/** Page actions that belong in the shared AppLayout navbar. */
export function NavbarEnd({ children }: { children: ReactNode }) {
  const target = useContext(NavbarEndContext);
  if (target == null) {
    return null;
  }
  return createPortal(children, target);
}

export function WorkbenchShell({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [navbarEnd, setNavbarEnd] = useState<HTMLElement | null>(null);
  const go = useCallback(
    (href: string) => {
      void navigate({ to: href });
    },
    [navigate],
  );

  return (
    <NavbarEndContext.Provider value={navbarEnd}>
      <AppLayout
        className="h-full min-h-0 flex-1"
        navigate={go}
        scrollMode="content"
        sidebar={<AppSidebar pathname={pathname} signedIn={signedIn} />}
        sidebarCollapsible="icon"
        navbar={<AppNavbar pathname={pathname} endRef={setNavbarEnd} />}
      >
        {children}
      </AppLayout>
    </NavbarEndContext.Provider>
  );
}

function AppNavbar({
  pathname,
  endRef,
}: {
  pathname: string;
  endRef: (node: HTMLElement | null) => void;
}) {
  const image = useMatch({
    from: "/_workbench/datasets/$dataset/$digest",
    shouldThrow: false,
  });
  const experiment = useMatch({
    from: "/_workbench/experiments/$experiment/",
    shouldThrow: false,
  });
  const experimentPhoto = useMatch({
    from: "/_workbench/experiments/$experiment/$dish/$round",
    shouldThrow: false,
  });
  const crumbs = workbenchCrumbs(
    pathname,
    image?.loaderData?.summary.filename ?? null,
    experimentPhoto?.loaderData?.experimentName ??
      experiment?.loaderData?.experiment.name ??
      null,
    experimentPhoto?.loaderData?.ref.dish ?? null,
    experimentPhoto?.loaderData?.round.label ?? null,
  );

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle />
        <Sidebar.Trigger aria-label="Toggle navigation" />
        <Breadcrumbs className="min-w-0">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Breadcrumbs.Item
                key={`${crumb.label}:${crumb.href ?? "current"}`}
                href={last ? undefined : crumb.href}
                className={`min-w-0 ${last ? "font-semibold" : "text-muted"} ${crumb.mono ? "font-mono" : ""}`}
              >
                <span className="truncate">{crumb.label}</span>
              </Breadcrumbs.Item>
            );
          })}
        </Breadcrumbs>
      </Navbar.Header>
      <Navbar.Spacer />
      <Navbar.Content>
        <div ref={endRef} className="flex items-center gap-3" />
      </Navbar.Content>
    </Navbar>
  );
}

function AppSidebar({
  pathname,
  signedIn,
}: {
  pathname: string;
  signedIn: boolean;
}) {
  const section = pathname.split("/")[1] || "datasets";

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
            <div className="truncate text-xs text-muted">Seed annotation</div>
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

type Crumb = { label: string; href?: string; mono?: boolean };

function workbenchCrumbs(
  pathname: string,
  filename: string | null,
  experimentName: string | null,
  dishLabel: string | null,
  roundLabel: string | null,
): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "experiments" && parts.length >= 2) {
    return experimentCrumbs(parts, experimentName, dishLabel, roundLabel);
  }
  if (parts[0] !== "datasets" || parts.length < 2) {
    const section =
      parts[0] === "training"
        ? "Training"
        : parts[0] === "status"
          ? "Status"
          : parts[0] === "experiments"
            ? "Experiments"
            : "Datasets";
    return [{ label: section }];
  }

  const dataset = parts[1]!;
  const crumbs: Crumb[] = [
    { label: "Datasets", href: "/" },
    {
      label: dataset,
      href: parts.length > 2 ? `/datasets/${dataset}` : undefined,
      mono: true,
    },
  ];

  if (parts.length >= 3 && parts[2] !== "training") {
    crumbs.push({
      label: filename ?? parts[2]!.slice(0, 12),
      mono: true,
    });
    return crumbs;
  }

  if (parts[2] !== "training") {
    return crumbs;
  }

  crumbs.push({
    label: "Training",
    href: parts.length > 3 ? `/datasets/${dataset}/training` : undefined,
  });
  if (parts[3]) {
    crumbs.push({
      label: trainingRunLabel({ id: parts[3] }),
      mono: true,
    });
  }
  return crumbs;
}

function experimentCrumbs(
  parts: string[],
  experimentName: string | null,
  dishLabel: string | null,
  roundLabel: string | null,
): Crumb[] {
  const experiment = parts[1]!;
  const crumbs: Crumb[] = [
    { label: "Experiments", href: "/experiments" },
    {
      label: experimentName ?? experiment.slice(0, 8),
      href: parts.length > 2 ? `/experiments/${experiment}` : undefined,
      mono: experimentName === null,
    },
  ];
  if (parts.length >= 4) {
    crumbs.push({
      label: `${dishLabel ?? "Dish"}, ${roundLabel ?? parts[3]!.slice(0, 8)}`,
      mono: dishLabel === null || roundLabel === null,
    });
  }
  return crumbs;
}
