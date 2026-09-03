import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { loginPath, requestedPath } from "./auth/navigation";
import { apiRequestAuthorization } from "./server/api-credentials";
import { readSession, redirect } from "./server/session";

/**
 * Paths that answer without a browser session: readiness, sign-in, the auth
 * API with its OAuth discovery documents, the agent API, which resolves the
 * account behind the API key it is given, and the MCP endpoint, which verifies
 * OAuth access tokens itself so it can issue the discovery challenge.
 */
function answersForItself(pathname: string): boolean {
  return (
    pathname === "/healthz" ||
    pathname === "/login" ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/.well-known/")
  );
}

const requireSession = createMiddleware().server(
  async ({ request, pathname, handlerType, next }) => {
    if (answersForItself(pathname)) {
      return next();
    }
    const bearerRealm = await apiRequestAuthorization(pathname, request);
    if (bearerRealm !== null) {
      return bearerRealm
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (await readSession(request.headers)) {
      return next();
    }
    if (handlerType === "serverFn" || pathname.startsWith("/api/")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return redirect(loginPath(requestedPath(request)));
  },
);

const requireSameOriginServerFunction = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSameOriginServerFunction, requireSession],
}));
