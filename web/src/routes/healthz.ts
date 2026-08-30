import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { database } from "../db/client";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { reachBlobStore } from "../server/blobs";
import { readModelVersion } from "../server/model-registry";

/**
 * Succeeds while the database answers with its builtin models in place and
 * the blob store answers. The server refuses to start until this passes, so
 * a deployment reads what is wrong from the check that refused it.
 */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const db = await database();
          await db.execute(sql`select 1`);
          if (
            !(await readModelVersion(SEED_DETECTOR_BASELINE_VERSION_ID, db))
          ) {
            throw new Error(
              `Builtin version ${SEED_DETECTOR_BASELINE_VERSION_ID} is missing`,
            );
          }
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
