import { asc, and, eq, inArray } from "drizzle-orm";

import { database, type Executor } from "../db/client";
import {
  datasetImages,
  experimentPhotos,
  experimentRounds,
} from "../db/schema";

/**
 * A display name for each image: the filename it was photographed under in
 * the earliest captured round, or failing that its earliest dataset
 * membership. Images carry no name of their own.
 */
export async function imageFilenames(
  digests: string[],
  db?: Executor,
): Promise<Map<string, string>> {
  if (digests.length === 0) return new Map();
  const executor = db ?? (await database());
  const [experimentRows, datasetRows] = await Promise.all([
    executor
      .select({
        imageId: experimentPhotos.imageId,
        filename: experimentPhotos.filename,
      })
      .from(experimentPhotos)
      .innerJoin(
        experimentRounds,
        and(
          eq(experimentRounds.experimentId, experimentPhotos.experimentId),
          eq(experimentRounds.id, experimentPhotos.roundId),
        ),
      )
      .where(inArray(experimentPhotos.imageId, digests))
      .orderBy(
        asc(experimentRounds.capturedAt),
        asc(experimentRounds.createdAt),
        asc(experimentPhotos.experimentId),
        asc(experimentPhotos.dishLabel),
      ),
    executor
      .select({
        imageId: datasetImages.imageId,
        filename: datasetImages.filename,
      })
      .from(datasetImages)
      .where(inArray(datasetImages.imageId, digests))
      .orderBy(asc(datasetImages.addedAt), asc(datasetImages.datasetId)),
  ]);
  const names = new Map<string, string>();
  for (const row of [...experimentRows, ...datasetRows]) {
    if (!names.has(row.imageId)) names.set(row.imageId, row.filename);
  }
  return names;
}
