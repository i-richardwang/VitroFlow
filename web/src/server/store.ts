import * as fs from "node:fs";
import * as path from "node:path";

import {
  resultSchema,
  type ImageKind,
  type SeedResult,
} from "../detection/schema";
import { REPO_ROOT, safeJoin } from "./paths";

const RUNS_DIR = path.join(REPO_ROOT, "data", "runs");

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export function listRunIds(): string[] {
  if (!fs.existsSync(RUNS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(RUNS_DIR)
    .filter((name) => fs.statSync(path.join(RUNS_DIR, name)).isDirectory())
    .sort()
    .reverse();
}

export function listStems(runId: string): string[] {
  return fs
    .readdirSync(safeJoin(RUNS_DIR, runId))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function readResult(runId: string, stem: string): SeedResult {
  const raw = fs.readFileSync(
    safeJoin(RUNS_DIR, runId, `${stem}.json`),
    "utf-8",
  );
  return resultSchema.parse(JSON.parse(raw));
}

export function readRunImage(
  runId: string,
  stem: string,
  kind: ImageKind,
): { body: Uint8Array<ArrayBuffer>; contentType: string } | null {
  const filePath =
    kind === "source"
      ? path.resolve(REPO_ROOT, readResult(runId, stem).source)
      : safeJoin(RUNS_DIR, runId, `${stem}_${kind}.jpg`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return {
    body: new Uint8Array(fs.readFileSync(filePath)),
    contentType:
      CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
      "application/octet-stream",
  };
}
