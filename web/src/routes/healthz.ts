import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { database } from "../db/client";
import { reachBlobStore } from "../server/blobs";

/**
 * Succeeds while the migrated database and the blob store both answer. The
 * body carries the reason one of them did not, so a deployment reads what is
 * wrong from the check that refused to start it.
 */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const db = await database();
          await db.execute(sql`select 1`);
          await reachBlobStore();
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 503 },
          );
        }
        return new Response("ok");
      },
    },
  },
});
