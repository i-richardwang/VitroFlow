import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import { imageDigestSchema } from "../datasets/schema";
import { fingerprintSchema, versionIdSchema } from "../inference/schema";
import { trainingParametersSchema } from "./parameters";

/** A snapshot needs one training and one validation image. */
export const MIN_SNAPSHOT_IMAGES = 2;

export const IMAGE_SPLITS = ["train", "val"] as const;
export type ImageSplit = (typeof IMAGE_SPLITS)[number];

export const TRAINING_PHASES = ["preparing", "training", "validating"] as const;
export type TrainingPhase = (typeof TRAINING_PHASES)[number];

export const TRAINING_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export const ACTIVE_TRAINING_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_TRAINING_RUN_STATUS_SET = new Set<string>(
  ACTIVE_TRAINING_RUN_STATUSES,
);

const snapshotImageSchema = z
  .strictObject({
    digest: imageDigestSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    split: z.enum(IMAGE_SPLITS),
    annotation: annotationSchema.refine(
      (annotation) => annotation.status === "complete",
      "Snapshot annotations must be complete",
    ),
  })
  .superRefine((image, context) => {
    if (image.annotation.image.digest !== image.digest) {
      context.addIssue({
        code: "custom",
        path: ["annotation", "image", "digest"],
        message: "Snapshot annotation describes another image",
      });
    }
    if (
      image.annotation.image.width !== image.width ||
      image.annotation.image.height !== image.height
    ) {
      context.addIssue({
        code: "custom",
        path: ["annotation", "image"],
        message: "Snapshot annotation dimensions differ from its image",
      });
    }
  });

export const datasetSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: versionIdSchema,
  datasetId: versionIdSchema,
  modelId: versionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  images: z.array(snapshotImageSchema).min(MIN_SNAPSHOT_IMAGES),
});

export const trainingRecipeSchema = z.strictObject({
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

const lossSchema = z.strictObject({
  box: z.number().finite(),
  classification: z.number().finite(),
  regression: z.number().finite(),
});

const unit = z.number().finite().min(0).max(1);

export const detectionValidationSchema = z.strictObject({
  precision: unit,
  recall: unit,
  map50: unit,
  map50_95: unit,
  fitness: z.number().finite(),
});

/** What Ultralytics knows after one epoch's validation pass. */
export const trainingEpochReportSchema = z.strictObject({
  epoch: z.number().int().positive(),
  train: lossSchema,
  val: lossSchema,
  precision: unit,
  recall: unit,
  map50: unit,
  map50To95: unit,
  fitness: z.number().finite(),
  learningRate: z.number().finite().nonnegative(),
});

export const trainingEpochSchema = trainingEpochReportSchema.extend({
  attempt: z.number().int().positive(),
  recordedAt: z.string().datetime({ offset: true }),
});

const trainingRunStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("queued") }),
  z.strictObject({
    status: z.literal("running"),
    workerId: versionIdSchema,
    sessionId: versionIdSchema,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    phase: z.enum(TRAINING_PHASES),
    progress: z.number().finite().min(0).max(1),
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
  validation: detectionValidationSchema,
  training: z.strictObject({
    base_model: z.strictObject({
      reference: z.string().min(1),
      digest: fingerprintSchema,
    }),
    parameters: trainingParametersSchema,
    runtime: z.strictObject({
      framework: z.literal("ultralytics"),
      version: z.string().min(1),
    }),
  }),
});

export type DatasetSnapshot = z.infer<typeof datasetSnapshotSchema>;
export type TrainingRecipe = z.infer<typeof trainingRecipeSchema>;
export type TrainingRun = z.infer<typeof trainingRunSchema>;
export type TrainingEpochReport = z.infer<typeof trainingEpochReportSchema>;
export type TrainingEpoch = z.infer<typeof trainingEpochSchema>;
export type InferencePublication = z.infer<typeof inferencePublicationSchema>;

export function isTrainingRunActive(run: Pick<TrainingRun, "state">): boolean {
  return ACTIVE_TRAINING_RUN_STATUS_SET.has(run.state.status);
}

const TRAINING_RUN_ID_PREFIX = "train-";

export function trainingRunId(uuid: string): string {
  return `${TRAINING_RUN_ID_PREFIX}${uuid}`;
}

/** The leading block of the run's UUID, enough to tell runs apart in a list. */
export function trainingRunLabel(run: Pick<TrainingRun, "id">): string {
  const uuid = run.id.startsWith(TRAINING_RUN_ID_PREFIX)
    ? run.id.slice(TRAINING_RUN_ID_PREFIX.length)
    : run.id;
  return uuid.slice(0, 8);
}
