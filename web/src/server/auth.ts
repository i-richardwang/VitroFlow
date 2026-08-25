import { createServerFn } from "@tanstack/react-start";

import { hasSession } from "./session";

export const getSession = createServerFn({ method: "GET" }).handler(() => ({
  signedIn: hasSession(),
}));
