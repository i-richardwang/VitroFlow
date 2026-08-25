import * as path from "node:path";

export const REPO_ROOT = path.resolve(process.cwd(), "..");

/** Joins a path under a data root, rejecting segments that could escape it. */
export function safeJoin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment !== path.basename(segment)) {
      throw new Error(`Invalid path segment: ${segment}`);
    }
  }
  return path.join(root, ...segments);
}
