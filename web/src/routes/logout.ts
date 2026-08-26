import { createFileRoute } from "@tanstack/react-router";

import { redirect, signOut } from "../server/session";

export const Route = createFileRoute("/logout")({
  server: {
    handlers: {
      POST: () => {
        signOut();
        return redirect("/login");
      },
    },
  },
});
