import { Button, Link } from "@heroui/react";
import {
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router";

import { getSession } from "../server/auth";

export const Route = createFileRoute("/_workbench")({
  loader: () => getSession(),
  component: WorkbenchLayout,
});

function WorkbenchLayout() {
  const { signedIn } = Route.useLoaderData();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onJobs = pathname === "/jobs" || pathname.startsWith("/jobs/");

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-separator bg-surface px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          VitroFlow
        </Link>
        <span className="text-xs text-muted">Seed annotation workbench</span>
        <nav className="ml-4 flex items-center gap-3 text-xs">
          <NavLink href="/" current={!onJobs}>
            Runs
          </NavLink>
          <NavLink href="/jobs" current={onJobs}>
            Jobs
          </NavLink>
        </nav>
        {signedIn && (
          <form method="post" action="/logout" className="ml-auto">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={current ? "font-medium text-accent" : undefined}
    >
      {children}
    </Link>
  );
}
