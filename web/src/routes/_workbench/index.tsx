import { createFileRoute, redirect } from "@tanstack/react-router";

/** Experiments are the work; the workbench opens on them. */
export const Route = createFileRoute("/_workbench/")({
  beforeLoad: () => {
    throw redirect({ to: "/experiments" });
  },
});
