import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { REVIEW_STATUSES, type AnnotationDocument } from "../annotation/schema";
import type { ImageRef } from "../datasets/schema";
import type { Prelabel } from "../detection/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { ModelArtifact, ModelVersion } from "../models/schema";
import {
  IMAGE_SPLITS,
  TRAINING_PHASES,
  TRAINING_RUN_STATUSES,
  type TrainingRecipe,
} from "../training/schema";

/**
 * Control plane and review state live in Postgres; photographs and model
 * weights are blobs addressed by relative key. Relationships between rows are
 * declared here so that no combination of rows the domain forbids can exist.
 * Images are atomic assets that datasets and snapshots refer to by digest;
 * the references, not the rows, keep an image alive.
 */

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  task: text("task").notNull(),
  classes: jsonb("classes").$type<string[]>().notNull(),
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
  },
  (table) => [
    index("model_versions_model_idx").on(table.modelId, table.createdAt),
    /** Lets referencing rows assert that a version belongs to their model. */
    unique("model_versions_id_model").on(table.id, table.modelId),
    /** Runtime records bind to executable content, not just a version name. */
    unique("model_versions_id_digest").on(table.id, table.artifactDigest),
    check(
      "model_versions_digest_check",
      sql`${table.artifactDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const datasets = pgTable(
  "datasets",
  {
    id: text("id").primaryKey(),
    /** Each dataset trains exactly one logical model. */
    modelId: text("model_id")
      .notNull()
      .unique()
      .references(() => models.id),
    selectedModelVersionId: text("selected_model_version_id").notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    unique("datasets_id_model").on(table.id, table.modelId),
    index("datasets_selected_version_idx").on(table.selectedModelVersionId),
    /** The selected version is one of the dataset's own model. */
    foreignKey({
      columns: [table.selectedModelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
  ],
);

/**
 * A photograph, identified by the SHA-256 digest of its bytes. Images belong
 * to no dataset; datasets, snapshots, and future experiments refer to them.
 * Every column describes the bytes themselves.
 */
export const images = pgTable(
  "images",
  {
    id: text("id").primaryKey(),
    /** The pixels the bytes hold, with orientation already applied. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    uploadedAt: instant("uploaded_at"),
  },
  (table) => [
    check("images_id_check", sql`${table.id} ~ '^[0-9a-f]{64}$'`),
    check("images_bytes_check", sql`${table.bytes} > 0`),
    check("images_size_check", sql`${table.width} > 0 and ${table.height} > 0`),
  ],
);

/** An image's membership in a dataset; review state hangs off this row. */
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

/** Review documents disappear together with the membership they describe. */
function membershipReference(table: {
  datasetId: AnyPgColumn;
  imageId: AnyPgColumn;
}) {
  return foreignKey({
    columns: [table.datasetId, table.imageId],
    foreignColumns: [datasetImages.datasetId, datasetImages.imageId],
  }).onDelete("cascade");
}

export const prelabels = pgTable(
  "prelabels",
  {
    datasetId: text("dataset_id").notNull(),
    imageId: text("image_id").notNull(),
    document: jsonb("document").$type<Prelabel>().notNull(),
    createdAt: instant("created_at"),
    /** Projections of `document` the workbench queries by. */
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id)
      .generatedAlwaysAs(sql`document->'producer'->>'model_version_id'`),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`document->'producer'->>'artifact_digest'`),
    error: text("error").generatedAlwaysAs(sql`document->>'error'`),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.imageId] }),
    membershipReference(table),
    foreignKey({
      columns: [table.modelVersionId, table.artifactDigest],
      foreignColumns: [modelVersions.id, modelVersions.artifactDigest],
    }),
    index("prelabels_version_idx").on(
      table.modelVersionId,
      table.artifactDigest,
    ),
    /** The document describes the image it is stored under. */
    check(
      "prelabels_image_check",
      sql`document->'image'->>'digest' = ${table.imageId}`,
    ),
  ],
);

export const labels = pgTable(
  "labels",
  {
    datasetId: text("dataset_id").notNull(),
    imageId: text("image_id").notNull(),
    document: jsonb("document").$type<AnnotationDocument>().notNull(),
    updatedAt: instant("updated_at"),
    /** Projections of `document` the workbench queries by. */
    status: text("status", { enum: REVIEW_STATUSES })
      .notNull()
      .generatedAlwaysAs(sql`document->>'status'`),
    revision: integer("revision")
      .notNull()
      .generatedAlwaysAs(sql`(document->>'revision')::integer`),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.imageId] }),
    membershipReference(table),
    index("labels_dataset_status_idx").on(table.datasetId, table.status),
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
 * An inference process by the runtimes it can execute. Which versions it
 * prelabels with follows from the datasets' selections; the version it holds
 * in memory is reported for display only.
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
    current: jsonb("current").$type<ImageRef | null>(),
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
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => datasetSnapshots.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    split: text("split", { enum: IMAGE_SPLITS }).notNull(),
    annotation: jsonb("annotation").$type<AnnotationDocument>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.imageId] }),
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
