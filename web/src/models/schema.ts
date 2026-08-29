import { z } from "zod";

import {
  fingerprintSchema,
  versionIdSchema,
  type RuntimeDescriptor,
} from "../inference/schema";
import { trainingParametersSchema } from "../training/parameters";
import { detectionValidationSchema } from "../training/schema";

export const modelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  name: z.string().min(1),
  task: z.literal("object_detection"),
  classes: z.tuple([z.literal("seed")]),
});

const inferenceSettingsSchema = z.strictObject({
  confidence: z.number().finite().min(0).max(1),
  imageSize: z.number().int().positive(),
  maxDetections: z.number().int().positive(),
  endToEnd: z.boolean(),
});

const trainingIdentitySchema = z.strictObject({
  baseModel: z.strictObject({
    reference: z.string().min(1),
    digest: fingerprintSchema,
  }),
  parameters: trainingParametersSchema,
  runtime: z.strictObject({
    framework: z.literal("ultralytics"),
    version: z.string().min(1),
  }),
});

const traditionalArtifactSchema = z.strictObject({
  kind: z.literal("traditional"),
  digest: fingerprintSchema,
});

const ultralyticsArtifactSchema = z.strictObject({
  kind: z.literal("ultralytics"),
  digest: fingerprintSchema,
  weights: z.strictObject({
    digest: fingerprintSchema,
    bytes: z.number().int().positive(),
  }),
  inference: inferenceSettingsSchema,
  validation: detectionValidationSchema,
  training: trainingIdentitySchema,
});

export const modelArtifactSchema = z.discriminatedUnion("kind", [
  traditionalArtifactSchema,
  ultralyticsArtifactSchema,
]);

const modelVersionIdentity = {
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  modelId: versionIdSchema,
  name: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
};

export const modelVersionSchema = z.union([
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("builtin"),
      definition: versionIdSchema,
    }),
    artifact: traditionalArtifactSchema,
  }),
  z.strictObject({
    ...modelVersionIdentity,
    source: z.strictObject({
      kind: z.literal("training_run"),
      trainingRunId: versionIdSchema,
      trainingAttempt: z.number().int().positive(),
      datasetSnapshotId: versionIdSchema,
    }),
    artifact: ultralyticsArtifactSchema,
  }),
]);

export type Model = z.infer<typeof modelSchema>;
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
  name: "map50" | "map50_95",
): number | null {
  if (artifact.kind !== "ultralytics") return null;
  return artifact.validation[name];
}
