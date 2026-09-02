import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { readSession } from "../server/session";

/** The signed-in account. The request middleware admits no session-less call. */
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await readSession(getRequestHeaders());
    if (!user) throw new Response("Unauthorized", { status: 401 });
    return { user };
  },
);
