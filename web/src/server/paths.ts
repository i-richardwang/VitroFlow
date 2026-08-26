import * as path from "node:path";

/**
 * Root of everything the workbench reads and writes:
 *
 *   images/<dataset>/<file>   source photographs
 *   jobs/<job-id>.json        recognition task state
 *   runs/<run-id>/            detection results and rendered views
 *   labels/<dataset>/<stem>   reviewed box annotations
 *   staging/<job-id>/         unpublished worker results
 *   workers/<worker-id>.json  latest heartbeat from each worker
 *
 * Run results reference images by path relative to this root, so the whole
 * tree can be mounted anywhere.
 */
export const DATA_ROOT =
  process.env.VITROFLOW_DATA_ROOT ?? path.resolve(process.cwd(), "..", "data");

export const IMAGES_DIR = path.join(DATA_ROOT, "images");
export const JOBS_DIR = path.join(DATA_ROOT, "jobs");
export const RUNS_DIR = path.join(DATA_ROOT, "runs");
export const LABELS_DIR = path.join(DATA_ROOT, "labels");
export const STAGING_DIR = path.join(DATA_ROOT, "staging");
export const WORKERS_DIR = path.join(DATA_ROOT, "workers");

export function resolveWithin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes ${root}: ${segments.join(path.sep)}`);
  }
  return resolved;
}

/**
 * Identifies an image across runs: its path relative to the images
 * directory without the extension, such as `fixtures/_DSF1687`.
 */
export function imageKey(source: string): string {
  const relative = path.relative(
    IMAGES_DIR,
    resolveWithin(DATA_ROOT, source),
  );
  if (relative.startsWith("..")) {
    throw new Error(`Source is not under ${IMAGES_DIR}: ${source}`);
  }
  return relative.slice(0, relative.length - path.extname(relative).length);
}
