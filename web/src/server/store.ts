import * as fs from "node:fs";
import * as path from "node:path";

import {
  resultSchema,
  type ImageKind,
  type SeedResult,
} from "../detection/schema";
import { DATA_ROOT, RUNS_DIR, resolveWithin } from "./paths";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function runDir(runId: string): string {
  return resolveWithin(RUNS_DIR, runId);
}

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
    .readdirSync(runDir(runId))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function readResult(runId: string, stem: string): SeedResult {
  const raw = fs.readFileSync(
    resolveWithin(runDir(runId), `${stem}.json`),
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
      ? resolveWithin(DATA_ROOT, readResult(runId, stem).source)
      : resolveWithin(runDir(runId), `${stem}_${kind}.jpg`);
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
