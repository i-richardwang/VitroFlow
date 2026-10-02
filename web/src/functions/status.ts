import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { isAdmin } from "../domain/auth/schema";
import { workerRefSchema } from "../domain/workers/schema";
import { getSystemStatus } from "../server/queries/public";
import { readSession } from "../server/transport/http/session";
import { enrollWorker, removeWorker } from "../server/workers/public";

async function requireAdmin(): Promise<void> {
  const user = await readSession(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  if (!isAdmin(user)) throw new Response("Forbidden", { status: 403 });
}

export const getStatus = createServerFn({ method: "GET" }).handler(
  getSystemStatus,
);

/** Administrators enroll the machines that may serve as workers. */
export const addWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    return enrollWorker(data.workerId);
  });

export const deleteWorker = createServerFn({ method: "POST" })
  .validator(workerRefSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    await removeWorker(data.workerId);
  });
