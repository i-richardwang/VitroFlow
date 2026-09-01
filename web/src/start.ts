import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { loginPath, requestedPath } from "./auth/navigation";
import { apiRequestAuthorization } from "./server/api-credentials";
import { isAuthenticated, redirect } from "./server/session";

const requireSession = createMiddleware().server(
  ({ request, pathname, handlerType, next }) => {
    if (pathname === "/healthz") {
      return next();
    }
    const tokenRealm = apiRequestAuthorization(pathname, request);
    if (tokenRealm !== null) {
      return tokenRealm
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (pathname === "/login" || isAuthenticated(request)) {
      return next();
    }
    if (handlerType === "serverFn") {
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
