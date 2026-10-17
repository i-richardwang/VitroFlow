import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  listTrainingEpochs,
  readDatasetSnapshot,
  readTrainingRun,
} from "../training/public";
import { readDataset } from "../datasets/public";
import {
  readCurrentVersionId,
  readModel,
  readModelVersion,
} from "../models/public";

/** One run with its whole epoch history, the version it published, and whether that version reads. */
export async function trainingRunDetail(
  datasetId: string,
  runId: string,
): Promise<TrainingRunDetail | null> {
  const dataset = await readDataset(datasetId);
  const run = await readTrainingRun(runId);
  if (!dataset || !run) return null;
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId);
  if (snapshot?.datasetId !== dataset.id) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const version =
    run.state.status === "succeeded"
      ? await readModelVersion(run.state.modelVersionId)
      : null;
  return {
    dataset,
    model,
    run,
    epochs: await listTrainingEpochs(runId),
    version,
    current:
      version !== null && (await readCurrentVersionId(model.id)) === version.id,
  };
}
