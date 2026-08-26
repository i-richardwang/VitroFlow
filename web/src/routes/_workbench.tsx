import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkbenchShell } from "../components/shell";
import { getSession } from "../server/auth";

export const Route = createFileRoute("/_workbench")({
  loader: () => getSession(),
  component: WorkbenchLayout,
});

function WorkbenchLayout() {
  const { signedIn } = Route.useLoaderData();

  return (
    <WorkbenchShell signedIn={signedIn}>
      <Outlet />
    </WorkbenchShell>
  );
}
