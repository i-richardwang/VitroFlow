import { createFileRoute } from "@tanstack/react-router";

import { signOut } from "../server/session";

export const Route = createFileRoute("/logout")({
  server: {
    handlers: {
      POST: ({ request }) => {
        signOut();
        return Response.redirect(new URL("/login", request.url), 303);
      },
    },
  },
});
