import { sql } from "drizzle-orm";

import type { Executor } from "../db/client";

/**
 * Serializes every write that decides what is recorded for one image under
 * one model version. The key differs in shape from an image digest, so the
 * lock never collides with `lockImage`.
 */
export async function lockDetection(
  digest: string,
  versionId: string,
  tx: Executor,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${digest}:${versionId}`}))`,
  );
}
