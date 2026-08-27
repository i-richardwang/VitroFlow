import { createMiddleware, createStart } from "@tanstack/react-start";

import { isAuthenticated, redirect } from "./server/session";
import {
  isInferenceWorkerAuthenticated,
  isTrainingWorkerAuthenticated,
} from "./server/worker-auth";

const requireSession = createMiddleware().server(
  ({ request, pathname, handlerType, next }) => {
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
    if (pathname === "/login" || isAuthenticated(request)) {
      return next();
    }
    if (handlerType === "serverFn") {
      return new Response("Unauthorized", { status: 401 });
    }
    return redirect("/login");
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSession],
}));
