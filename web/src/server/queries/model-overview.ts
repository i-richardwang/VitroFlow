import type { ModelCatalogueEntry } from "../../domain/models/contracts";
import type {
  TrainingRunSummary,
  VersionOverview,
} from "../../domain/training/read-model";
import type { DatasetSummary } from "../../domain/datasets/schema";
import { listDatasetSummaries } from "../datasets/public";
import { listAllModelVersions, readCurrentVersionId } from "../models/public";
import {
  listTrainingRunSummaries,
  snapshotImageCounts,
} from "../training/public";
import { modelCatalogue } from "./model-catalogue";
import { versionComparisons } from "./version-comparison";
import type {
  VersionComparison,
  VersionComparisonDetail,
} from "../../domain/models/comparison";

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
 * trained each, which one reads and how each candidate compares with it,
 * the training sets that train it, and their runs.
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
    listDatasetSummaries(modelId),
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
  const [currentVersionId, comparisons] = await Promise.all([
    readCurrentVersionId(modelId),
    versionComparisons(modelId),
  ]);
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
    current: version.id === currentVersionId,
    comparison: summary(comparisons.get(version.id)),
  }));
}

/** A comparison without its images, which the page asks for one version at a time. */
function summary(
  detail: VersionComparisonDetail | undefined,
): VersionComparison | null {
  if (!detail) return null;
  const { images: _images, ...comparison } = detail;
  return comparison;
}
