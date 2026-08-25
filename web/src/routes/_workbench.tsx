import { Button, Link } from "@heroui/react";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { getSession } from "../server/auth";

export const Route = createFileRoute("/_workbench")({
  loader: () => getSession(),
  component: WorkbenchLayout,
});

function WorkbenchLayout() {
  const { signedIn } = Route.useLoaderData();
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
          <Link href="/">Runs</Link>
          <Link href="/jobs">Jobs</Link>
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
