import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkbenchNotice } from "../components/WorkbenchNotice";
import { Shell } from "../components/shell";
import { getSession } from "../functions/session";

export const Route = createFileRoute("/_workbench")({
  loader: () => getSession(),
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
      <WorkbenchNotice
        title="Not found"
        description="The dataset, image, experiment, or run is not in this workbench."
      />
    </Shell>
  );
}

function WorkbenchError({ error }: { error: Error }) {
  return (
    <Shell>
      <WorkbenchNotice
        title="Something went wrong"
        description={error.message}
      />
    </Shell>
  );
}
