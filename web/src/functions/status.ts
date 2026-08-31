import { createServerFn } from "@tanstack/react-start";

import { getSystemStatus } from "../server/status";

export const getStatus = createServerFn({ method: "GET" }).handler(
  getSystemStatus,
);
