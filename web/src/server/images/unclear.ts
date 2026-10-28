import { eq, inArray } from "drizzle-orm";

import { database, inTransaction, type Executor } from "../infra/db/client";
import { images, unclearImages } from "../infra/db/schema";
import { ImageNotFoundError } from "../../domain/images/errors";
import type { ImageRef } from "../../domain/images/schema";
import {
  unclearMarkSchema,
  type UnclearCleared,
  type UnclearDecision,
  type UnclearImage,
  type UnclearImageRequest,
  type UnclearMark,
} from "../../domain/images/unclear";
import { lockImage } from "./lock";

/**
 * Whether a photograph could be read clearly is said of the canonical image,
 * wherever it is shown. Marking or clearing it changes no reading: the grid,
 * the spreadsheet and training read the mark beside the readings they have.
 */

/** A stored mark as every reader carries it; a row left-joined and absent is no mark. */
export function toUnclearMark(
  row: typeof unclearImages.$inferSelect | null,
): UnclearMark | null {
  return row
    ? unclearMarkSchema.parse({
        counted: row.counted,
        note: row.note,
        recordedAt: row.recordedAt.toISOString(),
      })
    : null;
}

async function requireStoredImage(digest: string, tx: Executor) {
  const [stored] = await tx
    .select({ id: images.id })
    .from(images)
    .where(eq(images.id, digest));
  if (!stored) throw new ImageNotFoundError(`Unknown image: ${digest}`);
}

/**
 * Marks the image unclear, or replaces the mark it has, as `recordedBy` says:
 * the account behind a workbench session, or none for an agent or an import.
 * Marking again with the same decision changes nothing but who and when.
 */
export async function markImageUnclear(
  { digest, counted, note }: UnclearImageRequest,
  recordedBy: string | null,
  executor?: Executor,
): Promise<UnclearImage> {
  return inTransaction(executor, async (tx) => {
    await lockImage(digest, tx);
    await requireStoredImage(digest, tx);
    const recordedAt = new Date();
    const [row] = await tx
      .insert(unclearImages)
      .values({ imageId: digest, counted, note, recordedBy, recordedAt })
      .onConflictDoUpdate({
        target: unclearImages.imageId,
        set: { counted, note, recordedBy, recordedAt },
      })
      .returning();
    if (!row) throw new Error("Unclear mark was not recorded");
    return { digest, ...toUnclearMark(row)! };
  });
}

/**
 * Marks several images unclear in one transaction, each with its own decision.
 * Digests are locked in sorted order.
 */
export async function markImagesUnclear(
  marks: ReadonlyMap<string, UnclearDecision>,
  recordedBy: string | null,
  tx: Executor,
): Promise<void> {
  for (const digest of [...marks.keys()].sort()) {
    await markImageUnclear({ digest, ...marks.get(digest)! }, recordedBy, tx);
  }
}

/** Clears the image's mark: it reads as clear again. Clearing twice is harmless. */
export async function clearImageUnclear(
  { digest }: ImageRef,
  executor?: Executor,
): Promise<UnclearCleared> {
  return inTransaction(executor, async (tx) => {
    await lockImage(digest, tx);
    await requireStoredImage(digest, tx);
    const removed = await tx
      .delete(unclearImages)
      .where(eq(unclearImages.imageId, digest))
      .returning({ imageId: unclearImages.imageId });
    return { digest, cleared: removed.length > 0 };
  });
}

/** The marks the named images carry; an image with none is clear. */
export async function readUnclearMarks(
  digests: readonly string[],
  executor?: Executor,
): Promise<Map<string, UnclearMark>> {
  if (digests.length === 0) return new Map();
  const db = executor ?? (await database());
  const rows = await db
    .select()
    .from(unclearImages)
    .where(inArray(unclearImages.imageId, [...new Set(digests)]));
  return new Map(rows.map((row) => [row.imageId, toUnclearMark(row)!]));
}
