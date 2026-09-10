import { createRouter } from "@tanstack/react-router";

import type { Crumb } from "./ui/shell/shell";
import { routeTree } from "./routeTree.gen";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * The breadcrumb trail the navbar shows while this route is the deepest
     * match. Evaluated at render, so labels resolve in the request's locale.
     */
    crumbs?: (match: {
      loaderData: unknown;
      params: Record<string, string>;
    }) => Crumb[];
  }
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}
