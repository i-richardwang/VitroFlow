import { createMiddleware, createStart } from "@tanstack/react-start";

import { isAuthenticated } from "./server/session";
import { isWorkerAuthenticated } from "./server/worker-auth";

const requireSession = createMiddleware().server(
  ({ request, pathname, handlerType, next }) => {
    if (pathname.startsWith("/api/worker/")) {
      return isWorkerAuthenticated(request)
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (pathname === "/login" || isAuthenticated(request)) {
      return next();
    }
    if (handlerType === "serverFn") {
      return new Response("Unauthorized", { status: 401 });
    }
    return Response.redirect(new URL("/login", request.url), 303);
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSession],
}));
