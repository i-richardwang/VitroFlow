import type { ModelCatalogueEntry } from "../../domain/models/contracts";
import type {
  TrainingRunSummary,
  VersionOverview,
} from "../../domain/training/read-model";
import {
  listDatasetsForModel,
  summarizeDataset,
  type DatasetSummary,
} from "../datasets/public";
import { listAllModelVersions } from "../models/public";
import {
  listTrainingRunSummaries,
  snapshotImageCounts,
} from "../training/public";
import { modelCatalogue } from "./model-catalogue";

/** A model with what has been built for it. */
interface ModelOverview extends ModelCatalogueEntry {
  versions: VersionOverview[];
  /** The training sets of the model. */
  datasets: DatasetSummary[];
  /** The newest runs across those sets. */
  runs: TrainingRunSummary[];
}

/**
 * Everything one model's page shows: its versions with how many images
 * trained each, the training sets that train it, and their runs.
 */
export async function modelOverview(
  modelId: string,
): Promise<ModelOverview | null> {
  const entry = (await modelCatalogue()).find(
    (item) => item.model.id === modelId,
  );
  if (!entry) return null;
  const [versions, datasets, runs] = await Promise.all([
    listVersionOverviews(modelId),
    listDatasetsForModel(modelId).then((datasets) =>
      Promise.all(
        datasets.map((dataset) => summarizeDataset(dataset.id, modelId)),
      ),
    ),
    listTrainingRunSummaries({ modelId }),
  ]);
  return { ...entry, versions, datasets, runs };
}

async function listVersionOverviews(
  modelId: string,
): Promise<VersionOverview[]> {
  const versions = (await listAllModelVersions()).filter(
    (version) => version.modelId === modelId,
  );
  const trainingImages = await snapshotImageCounts(
    versions.flatMap((version) =>
      version.source.kind === "training_run"
        ? [version.source.datasetSnapshotId]
        : [],
    ),
  );
  return versions.map((version) => ({
    version,
    trainingImages:
      version.source.kind === "training_run"
        ? (trainingImages.get(version.source.datasetSnapshotId) ?? null)
        : null,
  }));
}
