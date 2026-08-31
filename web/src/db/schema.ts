import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  doublePrecision,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { REVIEW_STATUSES, type AnnotationDocument } from "../annotation/schema";
import type { InferenceOutcome } from "../detection/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { Reading } from "../models/readings";
import type { ModelArtifact, ModelVersion } from "../models/schema";
import {
  IMAGE_SPLITS,
  TRAINING_PHASES,
  TRAINING_RUN_STATUSES,
  type TrainingRecipe,
} from "../training/schema";

/**
 * Control plane, detections, and review state live in Postgres; photographs
 * and model weights are blobs addressed by relative key. Relationships between
 * rows are declared here so that no combination of rows the domain forbids can
 * exist. Images are atomic assets that datasets and snapshots refer to by
 * digest; the references, not the rows, keep an image alive.
 */

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  task: text("task").notNull(),
  classes: jsonb("classes").$type<string[]>().notNull(),
  readings: jsonb("readings").$type<Reading[]>().notNull(),
});

export const modelVersions = pgTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    name: text("name").notNull(),
    createdAt: instant("created_at"),
    source: jsonb("source").$type<ModelVersion["source"]>().notNull(),
    artifact: jsonb("artifact").$type<ModelArtifact>().notNull(),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'digest'`),
    sourceKind: text("source_kind")
      .notNull()
      .generatedAlwaysAs(sql`source->>'kind'`),
    sourceTrainingRunId: text("source_training_run_id")
      .generatedAlwaysAs(sql`source->>'trainingRunId'`)
      .references((): AnyPgColumn => trainingRuns.id),
    sourceTrainingAttempt: integer("source_training_attempt").generatedAlwaysAs(
      sql`(source->>'trainingAttempt')::integer`,
    ),
    sourceDatasetSnapshotId: text("source_dataset_snapshot_id")
      .generatedAlwaysAs(sql`source->>'datasetSnapshotId'`)
      .references((): AnyPgColumn => datasetSnapshots.id),
    artifactKind: text("artifact_kind")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'kind'`),
    weightsDigest: text("weights_digest").generatedAlwaysAs(
      sql`artifact->'weights'->>'digest'`,
    ),
    weightsBytes: integer("weights_bytes").generatedAlwaysAs(
      sql`(artifact->'weights'->>'bytes')::integer`,
    ),
  },
  (table) => [
    index("model_versions_model_idx").on(table.modelId, table.createdAt),
    /** Lets referencing rows assert that a version belongs to their model. */
    unique("model_versions_id_model").on(table.id, table.modelId),
    /** Runtime records bind to executable content, not just a version name. */
    unique("model_versions_id_digest").on(table.id, table.artifactDigest),
    unique("model_versions_publication_identity").on(
      table.id,
      table.sourceTrainingRunId,
      table.sourceTrainingAttempt,
      table.sourceDatasetSnapshotId,
      table.modelId,
    ),
    check(
      "model_versions_digest_check",
      sql`${table.artifactDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "model_versions_source_artifact_check",
      sql`case ${table.sourceKind}
        when 'builtin' then ${table.artifactKind} = 'traditional' and ${table.sourceTrainingRunId} is null and ${table.sourceTrainingAttempt} is null and ${table.sourceDatasetSnapshotId} is null and ${table.weightsDigest} is null and ${table.weightsBytes} is null
        when 'training_run' then ${table.artifactKind} = 'ultralytics' and ${table.sourceTrainingRunId} is not null and ${table.sourceTrainingAttempt} >= 1 and ${table.sourceDatasetSnapshotId} is not null and ${table.weightsDigest} ~ '^[0-9a-f]{64}$' and ${table.weightsBytes} > 0
        else false
      end`,
    ),
  ],
);

/**
 * A training set for one model: the photographs whose reviews for that model
 * train its next version. Datasets draw from experiment photographs; they
 * never receive uploads of their own.
 */
export const datasets = pgTable(
  "datasets",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** Lets snapshot rows assert that they froze this dataset for its model. */
    unique("datasets_id_model").on(table.id, table.modelId),
  ],
);

/**
 * A photograph, identified by the SHA-256 digest of its bytes. Images belong
 * to nothing; experiments, datasets, snapshots, and labels refer to them.
 * Every column describes the bytes themselves.
 *
 * An image with no reference is unclaimed: bytes arrive before the round they
 * join is submitted. `receivedAt` is when the bytes last arrived and bounds
 * how long that submission may still be in progress.
 */
export const images = pgTable(
  "images",
  {
    id: text("id").primaryKey(),
    /** The pixels the bytes hold, with orientation already applied. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    receivedAt: instant("received_at"),
  },
  (table) => [
    check("images_id_check", sql`${table.id} ~ '^[0-9a-f]{64}$'`),
    check("images_bytes_check", sql`${table.bytes} > 0`),
    check("images_size_check", sql`${table.width} > 0 and ${table.height} > 0`),
    /** The collector reads unreferenced images oldest first. */
    index("images_received_idx").on(table.receivedAt),
  ],
);

/** An image's membership in a dataset, with the split it keeps across snapshots. */
export const datasetImages = pgTable(
  "dataset_images",
  {
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    /** The name the image was added under; shown, never matched. */
    filename: text("filename").notNull(),
    addedAt: instant("added_at"),
    /** Assigned the first time the image enters a snapshot; stable afterwards. */
    split: text("split", { enum: IMAGE_SPLITS }),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.imageId] }),
    index("dataset_images_image_idx").on(table.imageId),
    check(
      "dataset_images_split_check",
      sql`${table.split} is null or ${table.split} in ('train', 'val')`,
    ),
  ],
);

/**
 * What a model version found in an image, addressed by its canonical business
 * key. Experiments read the row under the version they were created with, and
 * reviews under the version they started from; neither owns it. A
 * row is written once: an identical resubmission is accepted and a different
 * one refused, so the result stays a record and never a cache.
 */
export const inferenceOutcomes = pgTable(
  "inference_outcomes",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id").notNull(),
    document: jsonb("document").$type<InferenceOutcome>().notNull(),
    recordedAt: instant("recorded_at"),
    status: text("status", { enum: ["succeeded", "failed"] })
      .notNull()
      .generatedAlwaysAs(
        sql`case when document ? 'instances' then 'succeeded' when document ? 'error' then 'failed' end`,
      ),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`document->'producer'->>'artifact_digest'`),
    successfulImageId: text("successful_image_id").generatedAlwaysAs(
      sql`case when document ? 'instances' then image_id end`,
    ),
    successfulModelVersionId: text(
      "successful_model_version_id",
    ).generatedAlwaysAs(
      sql`case when document ? 'instances' then model_version_id end`,
    ),
    successfulArtifactDigest: text(
      "successful_artifact_digest",
    ).generatedAlwaysAs(
      sql`case when document ? 'instances' then document->'producer'->>'artifact_digest' end`,
    ),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelVersionId] }),
    unique("inference_outcomes_success_identity").on(
      table.successfulImageId,
      table.successfulModelVersionId,
      table.successfulArtifactDigest,
    ),
    index("inference_outcomes_version_idx").on(table.modelVersionId),
    index("inference_outcomes_status_idx").on(table.status, table.recordedAt),
    /** The document was produced by the registered artifact of its version. */
    foreignKey({
      columns: [table.modelVersionId, table.artifactDigest],
      foreignColumns: [modelVersions.id, modelVersions.artifactDigest],
    }),
    check(
      "inference_outcomes_document_check",
      sql`document->'image'->>'digest' = ${table.imageId} and document->'producer'->>'model_version_id' = ${table.modelVersionId}`,
    ),
    check(
      "inference_outcomes_shape_check",
      sql`case ${table.status}
        when 'succeeded' then document ? 'instances' and not document ? 'error'
        when 'failed' then document ? 'error' and not document ? 'instances'
        else false
      end`,
    ),
  ],
);

/**
 * What a reviewer decided about one image for one model: the human truth the
 * model's next version trains on. The review is the same document whether it
 * is opened from an experiment or from a dataset, because it belongs to the
 * image and the model, not to the place it was opened from. The version the
 * review started from is one of that model's, and its artifact is the one
 * registered for it.
 */
export const labels = pgTable(
  "labels",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    document: jsonb("document").$type<AnnotationDocument>().notNull(),
    updatedAt: instant("updated_at"),
    /** Projections of `document` the workbench queries by. */
    status: text("status", { enum: REVIEW_STATUSES })
      .notNull()
      .generatedAlwaysAs(sql`document->>'status'`),
    revision: integer("revision")
      .notNull()
      .generatedAlwaysAs(sql`(document->>'revision')::integer`),
    sourceModelVersionId: text("source_model_version_id")
      .notNull()
      .generatedAlwaysAs(sql`document->'source'->>'modelVersionId'`),
    sourceArtifactDigest: text("source_artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`document->'source'->>'artifactDigest'`),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelId] }),
    foreignKey({
      columns: [table.sourceModelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    foreignKey({
      columns: [table.sourceModelVersionId, table.sourceArtifactDigest],
      foreignColumns: [modelVersions.id, modelVersions.artifactDigest],
    }),
    foreignKey({
      columns: [
        table.imageId,
        table.sourceModelVersionId,
        table.sourceArtifactDigest,
      ],
      foreignColumns: [
        inferenceOutcomes.successfulImageId,
        inferenceOutcomes.successfulModelVersionId,
        inferenceOutcomes.successfulArtifactDigest,
      ],
    }),
    index("labels_model_status_idx").on(table.modelId, table.status),
    check(
      "labels_status_check",
      sql`${table.status} in ('in_progress', 'complete', 'excluded')`,
    ),
    check("labels_revision_check", sql`${table.revision} >= 0`),
    check(
      "labels_image_check",
      sql`document->'image'->>'digest' = ${table.imageId}`,
    ),
  ],
);

/**
 * Readings of the same dishes on successive occasions. The version is fixed
 * when the experiment is created, so every observation comes from the same
 * model: the builtin baseline until a trained version exists, and whichever
 * version the experiment was started with after that.
 */
export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id),
    createdAt: instant("created_at"),
  },
  (table) => [
    index("experiments_version_idx").on(table.modelVersionId),
    check(
      "experiments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check(
      "experiments_description_check",
      sql`${table.description} = btrim(${table.description}) and length(${table.description}) <= 2000`,
    ),
  ],
);

/**
 * The conditions an experiment compares. Dishes under one treatment are its
 * replicates; a treatment may exist before any dish is assigned to it.
 */
export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    /** Where the treatment sits in the design; groups are shown in this order. */
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    unique("experiment_treatments_name").on(table.experimentId, table.name),
    unique("experiment_treatments_position").on(
      table.experimentId,
      table.position,
    ),
    check(
      "experiment_treatments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check("experiment_treatments_position_check", sql`${table.position} >= 1`),
  ],
);

/** The dishes an experiment follows, labelled as the first round named them. */
export const experimentDishes = pgTable(
  "experiment_dishes",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Where the dish sits in the roster; rows are shown in this order. */
    position: integer("position").notNull(),
    /** The treatment this dish replicates, once the design assigns it. */
    treatmentId: uuid("treatment_id"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.label] }),
    foreignKey({
      columns: [table.experimentId, table.treatmentId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.id,
      ],
    }),
    index("experiment_dishes_treatment_idx").on(
      table.experimentId,
      table.treatmentId,
    ),
    unique("experiment_dishes_position").on(table.experimentId, table.position),
    check(
      "experiment_dishes_label_check",
      sql`${table.label} = btrim(${table.label}) and length(${table.label}) between 1 and 255`,
    ),
    check("experiment_dishes_position_check", sql`${table.position} >= 1`),
  ],
);

/** One business occasion on which some or all dishes were photographed. */
export const experimentRounds = pgTable(
  "experiment_rounds",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    label: text("label").notNull(),
    capturedAt: instant("captured_at"),
    createdAt: instant("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    unique("experiment_rounds_label").on(table.experimentId, table.label),
    index("experiment_rounds_captured_idx").on(
      table.experimentId,
      table.capturedAt,
      table.id,
    ),
    check(
      "experiment_rounds_label_check",
      sql`${table.label} = btrim(${table.label}) and length(${table.label}) between 1 and 80`,
    ),
  ],
);

/**
 * The photograph of one dish in one round. It refers to the image the way a
 * membership does, and the experiment reads the detection under its version.
 */
export const experimentPhotos = pgTable(
  "experiment_photos",
  {
    experimentId: uuid("experiment_id").notNull(),
    dishLabel: text("dish_label").notNull(),
    roundId: uuid("round_id").notNull(),
    /** An experiment photo is an image reference root; deletion is refused. */
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    filename: text("filename").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.experimentId, table.dishLabel, table.roundId],
    }),
    foreignKey({
      columns: [table.experimentId, table.dishLabel],
      foreignColumns: [experimentDishes.experimentId, experimentDishes.label],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.experimentId, table.roundId],
      foreignColumns: [experimentRounds.experimentId, experimentRounds.id],
    }).onDelete("cascade"),
    /** The same photograph cannot stand for two dishes or two occasions. */
    unique("experiment_photos_image").on(table.experimentId, table.imageId),
    index("experiment_photos_image_idx").on(table.imageId),
  ],
);

/**
 * An inference process by the runtimes it can execute. Which versions it
 * detects with follows from current demand; the version it holds in memory is
 * reported for display only.
 */
export const inferenceWorkers = pgTable(
  "inference_workers",
  {
    id: text("id").primaryKey(),
    startedAt: instant("started_at"),
    runtimes: jsonb("runtimes").$type<RuntimeDescriptor[]>().notNull(),
    loadedModelVersionId: text("loaded_model_version_id").references(
      () => modelVersions.id,
    ),
    /** The image being processed, by digest. */
    currentImageId: text("current_image_id").references(() => images.id, {
      onDelete: "set null",
    }),
    lastSeenAt: instant("last_seen_at"),
  },
  (table) => [index("inference_workers_seen_idx").on(table.lastSeenAt)],
);

export const datasetSnapshots = pgTable(
  "dataset_snapshots",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull(),
    modelId: text("model_id").notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** A snapshot's model is its dataset's model. */
    foreignKey({
      columns: [table.datasetId, table.modelId],
      foreignColumns: [datasets.id, datasets.modelId],
    }),
    unique("dataset_snapshots_id_model").on(table.id, table.modelId),
    index("dataset_snapshots_dataset_idx").on(table.datasetId),
  ],
);

/**
 * The reviewed images a snapshot froze, with the annotation as reviewed. The
 * image reference keeps the bytes alive for as long as the snapshot exists.
 */
export const datasetSnapshotImages = pgTable(
  "dataset_snapshot_images",
  {
    snapshotId: text("snapshot_id").notNull(),
    modelId: text("model_id").notNull(),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    split: text("split", { enum: IMAGE_SPLITS }).notNull(),
    annotation: jsonb("annotation").$type<AnnotationDocument>().notNull(),
    sourceModelVersionId: text("source_model_version_id")
      .notNull()
      .generatedAlwaysAs(sql`annotation->'source'->>'modelVersionId'`),
    sourceArtifactDigest: text("source_artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`annotation->'source'->>'artifactDigest'`),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.imageId] }),
    foreignKey({
      columns: [table.snapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceModelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    foreignKey({
      columns: [
        table.imageId,
        table.sourceModelVersionId,
        table.sourceArtifactDigest,
      ],
      foreignColumns: [
        inferenceOutcomes.successfulImageId,
        inferenceOutcomes.successfulModelVersionId,
        inferenceOutcomes.successfulArtifactDigest,
      ],
    }),
    index("dataset_snapshot_images_image_idx").on(table.imageId),
    check(
      "dataset_snapshot_images_split_check",
      sql`${table.split} in ('train', 'val')`,
    ),
    check(
      "dataset_snapshot_images_annotation_check",
      sql`annotation->'image'->>'digest' = ${table.imageId} and annotation->>'status' = 'complete'`,
    ),
  ],
);

export const trainingRuns = pgTable(
  "training_runs",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    datasetSnapshotId: text("dataset_snapshot_id").notNull(),
    createdAt: instant("created_at"),
    attempt: integer("attempt").notNull(),
    recipe: jsonb("recipe").$type<TrainingRecipe>().notNull(),
    status: text("status", { enum: TRAINING_RUN_STATUSES }).notNull(),
    workerId: text("worker_id"),
    sessionId: text("session_id"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    phase: text("phase", { enum: TRAINING_PHASES }),
    progress: real("progress"),
    error: text("error"),
    modelVersionId: text("model_version_id"),
  },
  (table) => [
    /** A run trains its model on a snapshot of that model's dataset. */
    foreignKey({
      columns: [table.datasetSnapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }),
    /** A run publishes a version of its own model. */
    foreignKey({
      columns: [table.modelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    foreignKey({
      columns: [
        table.modelVersionId,
        table.id,
        table.attempt,
        table.datasetSnapshotId,
        table.modelId,
      ],
      foreignColumns: [
        modelVersions.id,
        modelVersions.sourceTrainingRunId,
        modelVersions.sourceTrainingAttempt,
        modelVersions.sourceDatasetSnapshotId,
        modelVersions.modelId,
      ],
    }),
    check("training_runs_attempt_check", sql`${table.attempt} >= 0`),
    /** Each status has exactly the columns its state carries. */
    check(
      "training_runs_state_check",
      sql`case ${table.status}
        when 'queued' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is null
        when 'running' then ${table.workerId} is not null and ${table.sessionId} is not null and ${table.leaseExpiresAt} is not null and ${table.phase} in ('preparing', 'training', 'validating') and ${table.progress} is not null and ${table.progress} between 0 and 1 and ${table.error} is null and ${table.modelVersionId} is null
        when 'succeeded' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is not null
        when 'failed' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and length(${table.error}) between 1 and 2000 and ${table.modelVersionId} is null
        else false
      end`,
    ),
    /** A model trains one run at a time. */
    uniqueIndex("training_runs_one_active_per_model")
      .on(table.modelId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("training_runs_model_idx").on(table.modelId, table.createdAt),
    index("training_runs_claimable_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

/**
 * Ultralytics' per-epoch record, kept per attempt: a reclaimed run trains from
 * scratch, and the earlier attempt's curve stays part of the run's history.
 */
export const trainingEpochs = pgTable(
  "training_epochs",
  {
    runId: text("run_id")
      .notNull()
      .references(() => trainingRuns.id),
    attempt: integer("attempt").notNull(),
    epoch: integer("epoch").notNull(),
    recordedAt: instant("recorded_at"),
    trainBoxLoss: doublePrecision("train_box_loss").notNull(),
    trainClassificationLoss: doublePrecision(
      "train_classification_loss",
    ).notNull(),
    trainRegressionLoss: doublePrecision("train_regression_loss").notNull(),
    valBoxLoss: doublePrecision("val_box_loss").notNull(),
    valClassificationLoss: doublePrecision("val_classification_loss").notNull(),
    valRegressionLoss: doublePrecision("val_regression_loss").notNull(),
    precision: doublePrecision("precision").notNull(),
    recall: doublePrecision("recall").notNull(),
    map50: doublePrecision("map50").notNull(),
    map50To95: doublePrecision("map50_95").notNull(),
    fitness: doublePrecision("fitness").notNull(),
    learningRate: doublePrecision("learning_rate").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attempt, table.epoch] }),
    check(
      "training_epochs_order_check",
      sql`${table.attempt} >= 1 and ${table.epoch} >= 1`,
    ),
  ],
);

export const trainingWorkers = pgTable(
  "training_workers",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    startedAt: instant("started_at"),
    device: text("device").notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "number" }).notNull(),
    currentTrainingRunId: text("current_training_run_id").references(
      () => trainingRuns.id,
      { onDelete: "set null" },
    ),
    lastSeenAt: instant("last_seen_at"),
  },
  (table) => [index("training_workers_seen_idx").on(table.lastSeenAt)],
);
