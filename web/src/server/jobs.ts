import { createServerFn } from "@tanstack/react-start";

import { listJobs } from "./job-store";

export const getJobs = createServerFn({ method: "GET" }).handler(() =>
  listJobs(),
);
