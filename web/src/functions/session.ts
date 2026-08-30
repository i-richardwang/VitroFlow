import { createServerFn } from "@tanstack/react-start";

import { hasSession } from "../server/session";

export const getSession = createServerFn({ method: "GET" }).handler(() => ({
  signedIn: hasSession(),
}));
