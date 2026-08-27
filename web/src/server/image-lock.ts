import { sql } from "drizzle-orm";

import type { Executor } from "../db/client";

/**
 * Serializes operations that may create or remove one image's bytes. Every
 * participant locks digests in sorted order when it handles more than one.
 */
export async function lockImage(digest: string, tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${digest}))`);
}
