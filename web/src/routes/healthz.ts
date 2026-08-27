import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { database } from "../db/client";

/** Succeeds while the migrated database answers queries. */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const db = await database();
        await db.execute(sql`select 1`);
        return new Response("ok");
      },
    },
  },
});
