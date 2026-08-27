import * as path from "node:path";

/**
 * Root of everything the workbench reads and writes:
 *
 *   images/<dataset>/<stem>.<ext>     source photographs
 *   prelabels/<dataset>/<stem>.json   detector output, owned by workers
 *   labels/<dataset>/<stem>.json      reviewed box annotations
 *   datasets/<dataset>.json           dataset and selected model version
 *   models/<model-id>.json            stable logical models
 *   model-versions/<version-id>.json  immutable executable model versions
 *   inference-workers/<worker-id>.json latest inference heartbeat
 *   training-workers/<worker-id>.json latest training heartbeat
 *   dataset-splits/<dataset>.json      stable train/validation assignments
 *   dataset-snapshots/<digest>/        immutable reviewed training inputs
 *   training-runs/<run-id>.json        leased training state machines
 *   training-staging/<run-id>/         durable unpublished model artifacts
 *   model-artifacts/<version-id>/      published executable artifacts
 *
 * Documents reference images by path relative to this root, so the whole
 * tree can be mounted anywhere.
 */
export const DATA_ROOT =
  process.env.VITROFLOW_DATA_ROOT ?? path.resolve(process.cwd(), "..", "data");

export const IMAGES_DIR = path.join(DATA_ROOT, "images");
export const PRELABELS_DIR = path.join(DATA_ROOT, "prelabels");
export const LABELS_DIR = path.join(DATA_ROOT, "labels");
export const DATASETS_DIR = path.join(DATA_ROOT, "datasets");
export const MODELS_DIR = path.join(DATA_ROOT, "models");
export const MODEL_VERSIONS_DIR = path.join(DATA_ROOT, "model-versions");
export const INFERENCE_WORKERS_DIR = path.join(DATA_ROOT, "inference-workers");
export const TRAINING_WORKERS_DIR = path.join(DATA_ROOT, "training-workers");
export const DATASET_SNAPSHOTS_DIR = path.join(DATA_ROOT, "dataset-snapshots");
export const DATASET_SPLITS_DIR = path.join(DATA_ROOT, "dataset-splits");
export const TRAINING_RUNS_DIR = path.join(DATA_ROOT, "training-runs");
export const TRAINING_STAGING_DIR = path.join(DATA_ROOT, "training-staging");
export const MODEL_ARTIFACTS_DIR = path.join(DATA_ROOT, "model-artifacts");

export function resolveWithin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes ${root}: ${segments.join(path.sep)}`);
  }
  return resolved;
}
