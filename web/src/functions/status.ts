import { createServerFn } from "@tanstack/react-start";

import { getSystemStatus } from "../server/queries/public";

export const getStatus = createServerFn({ method: "GET" }).handler(
  getSystemStatus,
);
