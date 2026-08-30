import { createRouter } from "@tanstack/react-router";

import type { Crumb } from "./components/shell";
import { routeTree } from "./routeTree.gen";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    crumbs?:
      | Crumb[]
      | ((match: {
          loaderData: unknown;
          params: Record<string, string>;
        }) => Crumb[]);
  }
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}
