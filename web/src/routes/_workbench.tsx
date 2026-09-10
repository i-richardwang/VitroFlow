import { SignedInUser } from "../features/account/SignedInUser";
import type { ReactNode } from "react";
import { errorMessage } from "../ui/errors";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkbenchNotice } from "../ui/shell/WorkbenchNotice";
import { Shell } from "../ui/shell/shell";
import { getSession } from "../functions/session";
import { m } from "../paraglide/messages";

export const Route = createFileRoute("/_workbench")({
  beforeLoad: () => getSession(),
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
  const { user } = Route.useRouteContext();
  return <Shell account={<SignedInUser user={user} />}>{children}</Shell>;
}
