import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { SignedInUser } from "../features/account/SignedInUser";
import { getExperimentNames } from "../functions/experiments";
import { getSession } from "../functions/session";
import { m } from "../paraglide/messages";
import { errorMessage } from "../ui/errors";
import { useRefreshOnReturn } from "../ui/hooks/useRouteRefresh";
import { Shell } from "../ui/shell/Shell";
import { RouteNotice } from "../ui/RouteNotice";

/** Remember which of the shell's side panels are folded. The server reads them so the first frame matches. */
const NAV_COOKIE = "vitroflow_nav";
const INSPECTOR_COOKIE = "vitroflow_inspector";

const readCollapsed = createIsomorphicFn()
  .server((cookie: string) => getCookie(cookie) === "collapsed")
  .client((cookie: string) =>
    document.cookie.split("; ").includes(`${cookie}=collapsed`),
  );

function writeCollapsed(cookie: string, collapsed: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the next request's server render reads it, so the write is synchronous
  document.cookie = `${cookie}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

export const Route = createFileRoute("/_workbench")({
  beforeLoad: async () => ({
    ...(await getSession()),
    navCollapsed: readCollapsed(NAV_COOKIE),
    inspectorCollapsed: readCollapsed(INSPECTOR_COOKIE),
  }),
  loader: () => getExperimentNames(),
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
      <RouteNotice title={m.not_found()} />
    </WorkbenchShell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  return (
    <WorkbenchShell>
      <RouteNotice
        title={m.something_went_wrong()}
        description={errorMessage(error)}
      />
    </WorkbenchShell>
  );
}

function WorkbenchShell({ children }: { children: ReactNode }) {
  const { user, navCollapsed, inspectorCollapsed } = Route.useRouteContext();
  const experiments = Route.useLoaderData();
  const [collapsed, setCollapsed] = useState(navCollapsed);
  const [inspectorFolded, setInspectorFolded] = useState(inspectorCollapsed);
  useRefreshOnReturn();
  return (
    <Shell
      user={user}
      account={<SignedInUser user={user} />}
      experiments={experiments ?? []}
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        setCollapsed(next);
        writeCollapsed(NAV_COOKIE, next);
      }}
      inspectorCollapsed={inspectorFolded}
      onInspectorCollapsedChange={(next) => {
        setInspectorFolded(next);
        writeCollapsed(INSPECTOR_COOKIE, next);
      }}
    >
      {children}
    </Shell>
  );
}
