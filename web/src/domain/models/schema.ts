import { z } from "zod";

import { resourceIdSchema, sha256Schema } from "../identifiers/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import {
  detectionValidationSchema,
  trainingRecipeSchema,
} from "../training/schema";
import { classListSchema } from "./classes";

/**
 * A model is a task: what it looks for in an image. It exists as soon as
 * someone asks the question, with or without a version that can answer it;
 * until one is trained, the answers are a reviewer's. Every version of the
 * model finds the same classes; versions differ only in how well they find
 * them.
 */
export const modelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: resourceIdSchema,
  name: z.string().min(1),
  task: z.literal("object_detection"),
  classes: classListSchema,
});

/** What naming a new task asks for: what to call it, and what it finds. */
export const modelRequestSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string().min(1),
  classes: classListSchema,
});

export const modelRefSchema = z.strictObject({ model: resourceIdSchema });

const inferenceSettingsSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  imageSize: z.number().int().positive(),
  maxDetections: z.number().int().positive(),
  endToEnd: z.boolean(),
});

const traditionalArtifactSchema = z.strictObject({
  kind: z.literal("traditional"),
  digest: sha256Schema,
});

const ultralyticsArtifactSchema = z.strictObject({
  kind: z.literal("ultralytics"),
  digest: sha256Schema,
  weights: z.strictObject({
    digest: sha256Schema,
    bytes: z.number().int().positive(),
  }),
  inference: inferenceSettingsSchema,
  validation: detectionValidationSchema,
  training: trainingRecipeSchema,
});

export const modelArtifactSchema = z.discriminatedUnion("kind", [
  traditionalArtifactSchema,
  ultralyticsArtifactSchema,
]);

const modelVersionIdentity = {
  schemaVersion: z.literal(1),
  id: resourceIdSchema,
  modelId: resourceIdSchema,
  createdAt: z.string().datetime({ offset: true }),
};

export const modelVersionSchema = z.union([
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("builtin"),
      definition: resourceIdSchema,
    }),
    artifact: traditionalArtifactSchema,
  }),
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("training_run"),
      trainingRunId: resourceIdSchema,
      trainingAttempt: z.number().int().positive(),
      datasetSnapshotId: resourceIdSchema,
    }),
    artifact: ultralyticsArtifactSchema,
  }),
]);

export type Model = z.infer<typeof modelSchema>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelRef = z.infer<typeof modelRefSchema>;
export type ModelVersion = z.infer<typeof modelVersionSchema>;
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

export function sameModel(left: Model, right: Model): boolean {
  return (
    JSON.stringify(modelSchema.parse(left)) ===
    JSON.stringify(modelSchema.parse(right))
  );
}

export function sameModelVersion(
  left: ModelVersion,
  right: ModelVersion,
): boolean {
  return (
    JSON.stringify(modelVersionSchema.parse(left)) ===
    JSON.stringify(modelVersionSchema.parse(right))
  );
}

export function supportsRuntime(
  artifact: ModelArtifact,
  runtime: RuntimeDescriptor,
): boolean {
  return (
    (artifact.kind === "traditional" && runtime.adapter === "traditional") ||
    (artifact.kind === "ultralytics" && runtime.adapter === "ultralytics")
  );
}

/** The part of a version id that distinguishes it within its model. */
export function versionSlug(
  version: Pick<ModelVersion, "id" | "modelId">,
): string {
  const prefix = `${version.modelId}.`;
  return version.id.startsWith(prefix)
    ? version.id.slice(prefix.length)
    : version.id;
}

export function validationMetric(
  artifact: ModelArtifact,
  name: "map50" | "map50To95",
): number | null {
  if (artifact.kind !== "ultralytics") return null;
  return artifact.validation[name];
}
