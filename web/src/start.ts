import { createMiddleware, createStart } from "@tanstack/react-start";

import { loginPath, requestedPath } from "./auth/navigation";
import { isAuthenticated, redirect } from "./server/session";
import {
  isExportAuthenticated,
  isInferenceWorkerAuthenticated,
  isTrainingWorkerAuthenticated,
} from "./server/worker-auth";

const requireSession = createMiddleware().server(
  ({ request, pathname, handlerType, next }) => {
    if (pathname === "/healthz") {
      return next();
    }
    if (pathname.startsWith("/api/inference/")) {
      return isInferenceWorkerAuthenticated(request)
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (pathname.startsWith("/api/training/")) {
      return isTrainingWorkerAuthenticated(request)
        ? next()
        : new Response("Unauthorized", { status: 401 });
    }
    if (pathname.startsWith("/api/export/")) {
      return isExportAuthenticated(request)
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

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSession],
}));
