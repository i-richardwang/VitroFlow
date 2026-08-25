import * as path from "node:path";

/**
 * Root of everything the workbench reads and writes:
 *
 *   images/<dataset>/<file>   source photographs
 *   runs/<run-id>/            detection results and rendered views
 *   labels/<dataset>/<stem>   reviewed box annotations
 *
 * Run results reference images by path relative to this root, so the whole
 * tree can be mounted anywhere.
 */
export const DATA_ROOT =
  process.env.VITROFLOW_DATA_ROOT ?? path.resolve(process.cwd(), "..", "data");

export const IMAGES_DIR = path.join(DATA_ROOT, "images");
export const RUNS_DIR = path.join(DATA_ROOT, "runs");
export const LABELS_DIR = path.join(DATA_ROOT, "labels");

/** Resolves a relative path under a root, rejecting anything that escapes it. */
export function resolveWithin(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes ${root}: ${relative}`);
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
