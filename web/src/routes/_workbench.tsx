import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkbenchNotice } from "../components/WorkbenchNotice";
import { WorkbenchShell } from "../components/shell";
import { getSession } from "../functions/session";

export const Route = createFileRoute("/_workbench")({
  loader: () => getSession(),
  component: WorkbenchLayout,
  notFoundComponent: WorkbenchNotFound,
  errorComponent: WorkbenchError,
});

function WorkbenchLayout() {
  const { signedIn } = Route.useLoaderData();

  return (
    <WorkbenchShell signedIn={signedIn}>
      <Outlet />
    </WorkbenchShell>
  );
}

function WorkbenchNotFound() {
  const { signedIn } = Route.useLoaderData();
  return (
    <WorkbenchShell signedIn={signedIn}>
      <WorkbenchNotice
        title="Not found"
        description="The dataset, image, experiment, or run is not in this workbench."
      />
    </WorkbenchShell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  const { signedIn } = Route.useLoaderData();
  return (
    <WorkbenchShell signedIn={signedIn}>
      <WorkbenchNotice
        title="Something went wrong"
        description={error.message}
      />
    </WorkbenchShell>
  );
}
