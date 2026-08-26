import * as path from "node:path";

/**
 * Root of everything the workbench reads and writes:
 *
 *   images/<dataset>/<stem>.<ext>     source photographs
 *   prelabels/<dataset>/<stem>.json   detector output, owned by workers
 *   labels/<dataset>/<stem>.json      reviewed box annotations
 *   datasets/<dataset>.json           dataset and logical-model definition
 *   prelabelers/<version-id>.json     immutable executable-version registry
 *   workers/<worker-id>.json          latest heartbeat from each worker
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
export const PRELABELERS_DIR = path.join(DATA_ROOT, "prelabelers");
export const WORKERS_DIR = path.join(DATA_ROOT, "workers");

export function resolveWithin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes ${root}: ${segments.join(path.sep)}`);
  }
  return resolved;
}
