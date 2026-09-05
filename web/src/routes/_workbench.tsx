import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkbenchNotice } from "../components/WorkbenchNotice";
import { Shell } from "../components/shell";
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
    <Shell>
      <Outlet />
    </Shell>
  );
}

function WorkbenchNotFound() {
  return (
    <Shell>
      <WorkbenchNotice title={m.not_found()} />
    </Shell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  return (
    <Shell>
      <WorkbenchNotice
        title={m.something_went_wrong()}
        description={error.message}
      />
    </Shell>
  );
}
