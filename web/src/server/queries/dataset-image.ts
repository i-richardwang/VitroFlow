import { eq } from "drizzle-orm";

import { database } from "../infra/db/client";
import { datasetImages } from "../infra/db/schema";
import type { DatasetImageStep, DatasetImageView } from "../../datasets/image";
import type { DatasetImageRef } from "../../datasets/schema";
import { membershipOrder, readDataset } from "../datasets/public";
import { readModel } from "../models/public";
import { readReview } from "../annotations/public";

export async function readDatasetImage(
  ref: DatasetImageRef,
): Promise<DatasetImageView | null> {
  const db = await database();
  const dataset = await readDataset(ref.dataset, db);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId, db);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const members = await db
    .select({
      digest: datasetImages.imageId,
      filename: datasetImages.filename,
      split: datasetImages.split,
    })
    .from(datasetImages)
    .where(eq(datasetImages.datasetId, ref.dataset))
    .orderBy(...membershipOrder());
  const at = members.findIndex((member) => member.digest === ref.digest);
  if (at < 0) return null;
  const member = members[at]!;
  const review = await readReview(
    { digest: ref.digest, modelId: dataset.modelId },
    member.filename,
    db,
  );
  if (!review) return null;
  const step = (index: number): DatasetImageStep | null => {
    const neighbour = members[index];
    return neighbour
      ? { digest: neighbour.digest, filename: neighbour.filename }
      : null;
  };
  return {
    dataset,
    model,
    review,
    split: member.split,
    previous: step(at - 1),
    next: step(at + 1),
  };
}
