import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { readDataset, listImages } from "./datasets";
import { createDirectoryAtomically, writeAtomically } from "./files";
import { readLabel } from "./labels";
import {
  DATASET_SNAPSHOTS_DIR,
  DATASET_SPLITS_DIR,
  resolveWithin,
} from "./paths";
import {
  datasetSnapshotSchema,
  type DatasetSnapshot,
} from "../training/schema";

type Split = "train" | "val";
interface SplitRegistry {
  schemaVersion: 1;
  datasetId: string;
  assignments: Record<string, Split>;
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function snapshotPath(snapshotId: string): string {
  return resolveWithin(DATASET_SNAPSHOTS_DIR, snapshotId, "manifest.json");
}

function splitPath(datasetId: string): string {
  return resolveWithin(DATASET_SPLITS_DIR, `${datasetId}.json`);
}

function readSplits(datasetId: string): SplitRegistry {
  const filePath = splitPath(datasetId);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, datasetId, assignments: {} };
  }
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (
    !value ||
    typeof value !== "object" ||
    (value as SplitRegistry).schemaVersion !== 1 ||
    (value as SplitRegistry).datasetId !== datasetId
  ) {
    throw new Error(`Invalid split registry for ${datasetId}`);
  }
  const registry = value as SplitRegistry;
  for (const [source, split] of Object.entries(registry.assignments)) {
    if (!source.startsWith(`images/${datasetId}/`) || !["train", "val"].includes(split)) {
      throw new Error(`Invalid split assignment for ${source}`);
    }
  }
  return registry;
}

function assignSplits(datasetId: string, sources: string[]): Record<string, Split> {
  const registry = readSplits(datasetId);
  const assignedNow: string[] = [];
  for (const source of sources) {
    if (!registry.assignments[source]) {
      const bucket = Number.parseInt(digest(source).slice(0, 8), 16) / 0xffffffff;
      registry.assignments[source] = bucket < 0.2 ? "val" : "train";
      assignedNow.push(source);
    }
  }
  const selected = sources.map((source) => registry.assignments[source]);
  if (!selected.includes("val")) {
    const source = [...assignedNow].sort((a, b) =>
      digest(a).localeCompare(digest(b)),
    )[0];
    if (!source) {
      throw new Error(
        "Stable split has no validation image; add another reviewed image",
      );
    }
    registry.assignments[source] = "val";
  }
  if (!sources.map((source) => registry.assignments[source]).includes("train")) {
    const source = [...assignedNow].sort((a, b) =>
      digest(b).localeCompare(digest(a)),
    )[0];
    if (!source) {
      throw new Error("Stable split has no training image; add another reviewed image");
    }
    registry.assignments[source] = "train";
  }
  writeAtomically(splitPath(datasetId), `${JSON.stringify(registry, null, 2)}\n`);
  return registry.assignments;
}

export function readDatasetSnapshot(snapshotId: string): DatasetSnapshot | null {
  const filePath = snapshotPath(snapshotId);
  if (!fs.existsSync(filePath)) return null;
  const snapshot = datasetSnapshotSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf-8")),
  );
  if (snapshot.id !== snapshotId) {
    throw new Error(`Dataset snapshot ${snapshot.id} does not match ${snapshotId}`);
  }
  return snapshot;
}

export function createDatasetSnapshot(datasetId: string): DatasetSnapshot {
  const dataset = readDataset(datasetId);
  if (!dataset) throw new Error(`Unknown dataset: ${datasetId}`);
  const reviewed = listImages(datasetId).flatMap((image) => {
    const annotation = readLabel(image);
    return annotation?.status === "complete" ? [{ image, annotation }] : [];
  });
  if (reviewed.length < 2) {
    throw new Error("Training requires at least two complete annotations");
  }
  const assignments = assignSplits(
    datasetId,
    reviewed.map(({ image }) => image.source),
  );
  const images = reviewed.map(({ image, annotation }, index) => ({
    ref: { dataset: image.dataset, stem: image.stem },
    source: image.source,
    artifactPath: `images/${index}${path.extname(image.filePath).toLowerCase()}`,
    imageDigest: digest(fs.readFileSync(image.filePath)),
    split: assignments[image.source],
    annotation,
  }));
  const identity = digest(
    JSON.stringify({ datasetId, modelId: dataset.modelId, images }),
  );
  const snapshotId = `snapshot-${identity}`;
  const existing = readDatasetSnapshot(snapshotId);
  if (existing) return existing;
  const snapshot = datasetSnapshotSchema.parse({
    schemaVersion: 1,
    id: snapshotId,
    datasetId,
    modelId: dataset.modelId,
    createdAt: new Date().toISOString(),
    images,
  });
  const directory = resolveWithin(DATASET_SNAPSHOTS_DIR, snapshot.id);
  if (!createDirectoryAtomically(directory, (temporary) => {
    for (const entry of snapshot.images) {
      const source = reviewed.find(({ image }) => image.source === entry.source)?.image;
      if (!source) throw new Error(`Missing image ${entry.source}`);
      const destination = path.join(temporary, entry.artifactPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source.filePath, destination);
    }
    fs.writeFileSync(
      path.join(temporary, "manifest.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  })) {
    return readDatasetSnapshot(snapshot.id) ?? snapshot;
  }
  return snapshot;
}

export function snapshotImagePath(
  snapshotId: string,
  index: number,
): { path: string; digest: string } | null {
  const snapshot = readDatasetSnapshot(snapshotId);
  const image = snapshot?.images[index];
  if (!snapshot || !image) return null;
  return {
    path: resolveWithin(DATASET_SNAPSHOTS_DIR, snapshot.id, image.artifactPath),
    digest: image.imageDigest,
  };
}
