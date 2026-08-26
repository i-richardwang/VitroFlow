import * as fs from "node:fs";

import {
  modelSchema,
  modelVersionFromPrelabeler,
  modelVersionSchema,
  sameModelVersion,
  type Model,
  type ModelVersion,
} from "../models/schema";
import type { PrelabelerDescriptor } from "../prelabelers/schema";
import { createAtomically } from "./files";
import { MODELS_DIR, MODEL_VERSIONS_DIR, resolveWithin } from "./paths";

export const DEFAULT_MODEL: Model = {
  schemaVersion: 1,
  id: "seed-detector",
  name: "Seed detector",
  task: "object_detection",
  classes: ["seed"],
};

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

export function ensureDefaultModel(): Model {
  return registerModel(DEFAULT_MODEL);
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
  modelId: string,
  prelabeler: PrelabelerDescriptor,
): ModelVersion {
  if (!readModel(modelId)) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  const version = modelVersionFromPrelabeler(modelId, prelabeler);
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
