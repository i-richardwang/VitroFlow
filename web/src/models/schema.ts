import { z } from "zod";

import {
  fingerprintSchema,
  versionIdSchema,
  type RuntimeDescriptor,
} from "../inference/schema";
import { trainingParametersSchema } from "../training/parameters";

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

const artifactPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "Artifact path must be relative",
  );

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

export const modelArtifactSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("traditional"),
    digest: fingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("ultralytics"),
    digest: fingerprintSchema,
    bytes: z.number().int().positive(),
    path: artifactPathSchema,
    inference: inferenceSettingsSchema,
    validation: z.record(z.string().min(1), z.number().finite()),
    training: trainingIdentitySchema,
  }),
]);

const modelVersionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("builtin"),
    definition: versionIdSchema,
  }),
  z.strictObject({
    kind: z.literal("training_run"),
    trainingRunId: versionIdSchema,
    datasetSnapshotId: versionIdSchema,
  }),
]);

export const modelVersionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  modelId: versionIdSchema,
  name: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  source: modelVersionSourceSchema,
  artifact: modelArtifactSchema,
});

export type Model = z.infer<typeof modelSchema>;
export type ModelVersion = z.infer<typeof modelVersionSchema>;
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

/** Parsed documents have canonical key order, so serialised equality is structural. */
export function sameModel(left: Model, right: Model): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sameModelVersion(
  left: ModelVersion,
  right: ModelVersion,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

/** A validation metric by its short name, e.g. `mAP50` from `metrics/mAP50(B)`. */
export function validationMetric(
  artifact: ModelArtifact,
  name: string,
): number | null {
  if (artifact.kind !== "ultralytics") return null;
  return artifact.validation[`metrics/${name}(B)`] ?? null;
}
