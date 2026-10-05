import type { TrainingRunDetail } from "../../domain/training/read-model";
import {
  listTrainingEpochs,
  readDatasetSnapshot,
  readTrainingRun,
} from "../training/public";
import { readDataset } from "../datasets/public";
import { readModel, readModelVersion } from "../models/public";

/** One run with its whole epoch history and the version it published. */
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
  return {
    dataset: dataset.id,
    model,
    run,
    epochs: await listTrainingEpochs(runId),
    version:
      run.state.status === "succeeded"
        ? await readModelVersion(run.state.modelVersionId)
        : null,
  };
}
