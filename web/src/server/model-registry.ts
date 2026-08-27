import * as fs from "node:fs";

import {
  modelSchema,
  modelVersionSchema,
  sameModelVersion,
  type Model,
  type ModelVersion,
} from "../models/schema";
import { TRADITIONAL_MODEL_MANIFEST } from "../models/builtins";
import { createAtomically } from "./files";
import { MODELS_DIR, MODEL_VERSIONS_DIR, resolveWithin } from "./paths";

export function builtinModel(datasetId: string): Model {
  return modelSchema.parse({
    schemaVersion: 1,
    id: datasetId,
    name: `${datasetId} seed detector`,
    task: "object_detection",
    classes: ["seed"],
  });
}

export function builtinTraditionalVersion(
  datasetId: string,
  createdAt: string,
): ModelVersion {
  return modelVersionSchema.parse({
    schemaVersion: 1,
    id: `${datasetId}.traditional-v1`,
    modelId: datasetId,
    name: "Traditional vision baseline",
    createdAt,
    source: {
      kind: "builtin",
      definition: TRADITIONAL_MODEL_MANIFEST.definition,
    },
    artifact: {
      kind: "traditional",
      digest: TRADITIONAL_MODEL_MANIFEST.artifactDigest,
    },
  });
}

function modelPath(modelId: string): string {
  return resolveWithin(MODELS_DIR, `${modelId}.json`);
}

function versionPath(versionId: string): string {
  return resolveWithin(MODEL_VERSIONS_DIR, `${versionId}.json`);
}

export function readModel(modelId: string): Model | null {
  const filePath = modelPath(modelId);
  if (!fs.existsSync(filePath)) return null;
  const model = modelSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf-8")),
  );
  if (model.id !== modelId) {
    throw new Error(`Model record ${model.id} does not match ${modelId}`);
  }
  return model;
}

export function listModels(): Model[] {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs
    .readdirSync(MODELS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readModel(name.slice(0, -5)))
    .filter((model): model is Model => model !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function registerModel(model: Model): Model {
  const valid = modelSchema.parse(model);
  const created = createAtomically(
    modelPath(valid.id),
    `${JSON.stringify(valid, null, 2)}\n`,
  );
  if (created) return valid;
  const existing = readModel(valid.id);
  if (!existing || JSON.stringify(existing) !== JSON.stringify(valid)) {
    throw new Error(
      `Model ${valid.id} is already registered with different contents`,
    );
  }
  return existing;
}

export function ensureDatasetModel(datasetId: string): ModelVersion {
  registerModel(builtinModel(datasetId));
  const versionId = `${datasetId}.traditional-v1`;
  const existing = readModelVersion(versionId);
  if (existing) return existing;
  return registerModelVersion(
    builtinTraditionalVersion(datasetId, new Date().toISOString()),
  );
}

export function readModelVersion(versionId: string): ModelVersion | null {
  const filePath = versionPath(versionId);
  if (!fs.existsSync(filePath)) return null;
  const version = modelVersionSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf-8")),
  );
  if (version.id !== versionId) {
    throw new Error(`Model version record ${version.id} does not match ${versionId}`);
  }
  return version;
}

export function listModelVersions(modelId?: string): ModelVersion[] {
  if (!fs.existsSync(MODEL_VERSIONS_DIR)) return [];
  return fs
    .readdirSync(MODEL_VERSIONS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readModelVersion(name.slice(0, -5)))
    .filter(
      (version): version is ModelVersion =>
        version !== null && (modelId === undefined || version.modelId === modelId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Registers one immutable executable version under an existing logical model. */
export function registerModelVersion(
  value: ModelVersion,
): ModelVersion {
  const version = modelVersionSchema.parse(value);
  if (!readModel(version.modelId)) {
    throw new Error(`Unknown model: ${version.modelId}`);
  }
  const created = createAtomically(
    versionPath(version.id),
    `${JSON.stringify(version, null, 2)}\n`,
  );
  if (created) return version;
  const existing = readModelVersion(version.id);
  if (!existing || !sameModelVersion(existing, version)) {
    throw new Error(
      `Model version ${version.id} is already registered with different contents`,
    );
  }
  return existing;
}

export function removeDatasetModel(datasetId: string): void {
  fs.rmSync(versionPath(`${datasetId}.traditional-v1`), { force: true });
  fs.rmSync(modelPath(datasetId), { force: true });
}
