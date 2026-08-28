import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Button } from "@heroui/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

import { BrandLogo } from "./BrandLogo";
import { DatasetsIcon, LogoutIcon, StatusIcon, TrainingIcon } from "./icons";

const NAV = [
  { href: "/", label: "Datasets", icon: DatasetsIcon, match: "datasets" },
  {
    href: "/training",
    label: "Training",
    icon: TrainingIcon,
    match: "training",
  },
  { href: "/status", label: "Status", icon: StatusIcon, match: "status" },
] as const;

export function WorkbenchShell({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const go = useCallback(
    (href: string) => {
      void navigate({ to: href });
    },
    [navigate],
  );

  return (
    <AppLayout
      className="h-full min-h-0 flex-1"
      navigate={go}
      scrollMode="content"
      sidebar={<AppSidebar pathname={pathname} signedIn={signedIn} />}
      sidebarCollapsible="icon"
      navbar={<AppNavbar pathname={pathname} />}
    >
      {children}
    </AppLayout>
  );
}

function AppNavbar({ pathname }: { pathname: string }) {
  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <Sidebar.Trigger aria-label="Toggle navigation" />
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          {titleFor(pathname)}
        </span>
      </Navbar.Header>
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
              size="sm"
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

function titleFor(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "datasets" && parts[1]) {
    return parts[parts.length - 1] ?? "Datasets";
  }
  return (
    NAV.find((item) => item.match === (parts[0] || "datasets"))?.label ??
    "Datasets"
  );
}
