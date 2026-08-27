import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { imageRefSchema, imageSourceSchema } from "../datasets/schema";
import { fingerprintSchema, versionIdSchema } from "../inference/schema";

export const snapshotImageSchema = z.strictObject({
  ref: imageRefSchema,
  source: imageSourceSchema,
  artifactPath: z.string().regex(/^images\/[0-9]+\.[A-Za-z0-9]+$/),
  imageDigest: fingerprintSchema,
  split: z.enum(["train", "val"]),
  annotation: annotationSchema.refine(
    (annotation) => annotation.status === "complete",
    "Snapshot annotations must be complete",
  ),
});

export const datasetSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  datasetId: versionIdSchema,
  modelId: versionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  images: z.array(snapshotImageSchema).min(2),
});

export const trainingRecipeSchema = z.strictObject({
  baseModel: z.strictObject({
    reference: z.string().min(1),
    digest: fingerprintSchema,
  }),
  configuration: z.strictObject({
    name: z.string().min(1),
    digest: fingerprintSchema,
  }),
  runtime: z.strictObject({
    framework: z.literal("ultralytics"),
    version: z.string().min(1),
  }),
  epochs: z.number().int().positive().optional(),
  imageSize: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
});

export const trainingRunStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("queued") }),
  z.strictObject({
    status: z.literal("running"),
    workerId: versionIdSchema,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    phase: z.enum(["preparing", "training", "validating"]),
    progress: z.number().finite().min(0).max(1),
  }),
  z.strictObject({
    status: z.literal("publishing"),
    workerId: versionIdSchema,
  }),
  z.strictObject({
    status: z.literal("succeeded"),
    modelVersionId: versionIdSchema,
  }),
  z.strictObject({
    status: z.literal("failed"),
    error: z.string().min(1).max(2000),
  }),
]);

export const trainingRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  modelId: versionIdSchema,
  datasetSnapshotId: versionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  attempt: z.number().int().nonnegative(),
  recipe: trainingRecipeSchema,
  state: trainingRunStateSchema,
});

export const inferencePublicationSchema = z.strictObject({
  schema_version: z.literal(1),
  weights: z.literal("weights/best.pt"),
  inference: z.strictObject({
    ready: z.literal(true),
    confidence: z.number().finite().min(0).max(1),
    imgsz: z.number().int().positive(),
    max_det: z.number().int().positive(),
    end2end: z.boolean(),
  }),
  validation: z.record(z.string().min(1), z.number().finite()),
  training: z.strictObject({
    base_model: z.strictObject({
      reference: z.string().min(1),
      digest: fingerprintSchema,
    }),
    configuration: z.strictObject({
      name: z.string().min(1),
      digest: fingerprintSchema,
    }),
    runtime: z.strictObject({
      framework: z.literal("ultralytics"),
      version: z.string().min(1),
    }),
  }),
});

export type DatasetSnapshot = z.infer<typeof datasetSnapshotSchema>;
export type TrainingRecipe = z.infer<typeof trainingRecipeSchema>;
export type TrainingRun = z.infer<typeof trainingRunSchema>;
export type InferencePublication = z.infer<typeof inferencePublicationSchema>;
