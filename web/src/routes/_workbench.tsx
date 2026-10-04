import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { SignedInUser } from "../features/account/SignedInUser";
import { getSession } from "../functions/session";
import { m } from "../paraglide/messages";
import { errorMessage } from "../ui/errors";
import { Shell } from "../ui/shell/shell";
import { WorkbenchNotice } from "../ui/shell/WorkbenchNotice";

/** Remembers the navigation rail. The server reads it so the first frame matches. */
const NAV_COOKIE = "vitroflow_nav";

const readNavCollapsed = createIsomorphicFn()
  .server(() => getCookie(NAV_COOKIE) === "collapsed")
  .client(() =>
    document.cookie.split("; ").includes(`${NAV_COOKIE}=collapsed`),
  );

function writeNavCollapsed(collapsed: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the next request's server render reads it, so the write is synchronous
  document.cookie = `${NAV_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

export const Route = createFileRoute("/_workbench")({
  beforeLoad: async () => ({
    ...(await getSession()),
    navCollapsed: readNavCollapsed(),
  }),
  component: WorkbenchLayout,
  notFoundComponent: WorkbenchNotFound,
  errorComponent: WorkbenchError,
});

function WorkbenchLayout() {
  return (
    <WorkbenchShell>
      <Outlet />
    </WorkbenchShell>
  );
}

function WorkbenchNotFound() {
  return (
    <WorkbenchShell>
      <WorkbenchNotice title={m.not_found()} />
    </WorkbenchShell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  return (
    <WorkbenchShell>
      <WorkbenchNotice
        title={m.something_went_wrong()}
        description={errorMessage(error)}
      />
    </WorkbenchShell>
  );
}

function WorkbenchShell({ children }: { children: ReactNode }) {
  const { user, navCollapsed } = Route.useRouteContext();
  const [collapsed, setCollapsed] = useState(navCollapsed);
  return (
    <Shell
      user={user}
      account={<SignedInUser user={user} />}
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        setCollapsed(next);
        writeNavCollapsed(next);
      }}
    >
      {children}
    </Shell>
  );
}
