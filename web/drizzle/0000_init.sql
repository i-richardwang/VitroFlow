CREATE TABLE "dataset_images" (
	"dataset_id" text NOT NULL,
	"image_id" text NOT NULL,
	"filename" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"split" text,
	CONSTRAINT "dataset_images_dataset_id_image_id_pk" PRIMARY KEY("dataset_id","image_id"),
	CONSTRAINT "dataset_images_split_check" CHECK ("dataset_images"."split" is null or "dataset_images"."split" in ('train', 'val'))
);
--> statement-breakpoint
CREATE TABLE "dataset_snapshot_images" (
	"snapshot_id" text NOT NULL,
	"model_id" text NOT NULL,
	"image_id" text NOT NULL,
	"split" text NOT NULL,
	"annotation" jsonb NOT NULL,
	"source_model_version_id" text GENERATED ALWAYS AS (annotation->'source'->>'modelVersionId') STORED NOT NULL,
	"source_artifact_digest" text GENERATED ALWAYS AS (annotation->'source'->>'artifactDigest') STORED NOT NULL,
	CONSTRAINT "dataset_snapshot_images_snapshot_id_image_id_pk" PRIMARY KEY("snapshot_id","image_id"),
	CONSTRAINT "dataset_snapshot_images_split_check" CHECK ("dataset_snapshot_images"."split" in ('train', 'val')),
	CONSTRAINT "dataset_snapshot_images_annotation_check" CHECK (annotation->'image'->>'digest' = "dataset_snapshot_images"."image_id" and annotation->>'status' = 'complete')
);
--> statement-breakpoint
CREATE TABLE "dataset_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dataset_snapshots_id_model" UNIQUE("id","model_id")
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "datasets_id_model" UNIQUE("id","model_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_dishes" (
	"experiment_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"treatment_id" uuid,
	CONSTRAINT "experiment_dishes_experiment_id_label_pk" PRIMARY KEY("experiment_id","label"),
	CONSTRAINT "experiment_dishes_position" UNIQUE("experiment_id","position"),
	CONSTRAINT "experiment_dishes_label_check" CHECK ("experiment_dishes"."label" = btrim("experiment_dishes"."label") and length("experiment_dishes"."label") between 1 and 255),
	CONSTRAINT "experiment_dishes_position_check" CHECK ("experiment_dishes"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "experiment_photos" (
	"experiment_id" uuid NOT NULL,
	"dish_label" text NOT NULL,
	"round_id" uuid NOT NULL,
	"image_id" text NOT NULL,
	"filename" text NOT NULL,
	CONSTRAINT "experiment_photos_experiment_id_dish_label_round_id_pk" PRIMARY KEY("experiment_id","dish_label","round_id"),
	CONSTRAINT "experiment_photos_image" UNIQUE("experiment_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_rounds" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"label" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experiment_rounds_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_rounds_label" UNIQUE("experiment_id","label"),
	CONSTRAINT "experiment_rounds_label_check" CHECK ("experiment_rounds"."label" = btrim("experiment_rounds"."label") and length("experiment_rounds"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "experiment_treatments" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "experiment_treatments_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_treatments_name" UNIQUE("experiment_id","name"),
	CONSTRAINT "experiment_treatments_position" UNIQUE("experiment_id","position"),
	CONSTRAINT "experiment_treatments_name_check" CHECK ("experiment_treatments"."name" = btrim("experiment_treatments"."name") and length("experiment_treatments"."name") between 1 and 120),
	CONSTRAINT "experiment_treatments_position_check" CHECK ("experiment_treatments"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"model_version_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experiments_name_check" CHECK ("experiments"."name" = btrim("experiments"."name") and length("experiments"."name") between 1 and 120),
	CONSTRAINT "experiments_description_check" CHECK ("experiments"."description" = btrim("experiments"."description") and length("experiments"."description") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" text PRIMARY KEY NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "images_id_check" CHECK ("images"."id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "images_bytes_check" CHECK ("images"."bytes" > 0),
	CONSTRAINT "images_size_check" CHECK ("images"."width" > 0 and "images"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "inference_outcomes" (
	"image_id" text NOT NULL,
	"model_version_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"status" text GENERATED ALWAYS AS (case when document ? 'instances' then 'succeeded' when document ? 'error' then 'failed' end) STORED NOT NULL,
	"artifact_digest" text GENERATED ALWAYS AS (document->'producer'->>'artifact_digest') STORED NOT NULL,
	"successful_image_id" text GENERATED ALWAYS AS (case when document ? 'instances' then image_id end) STORED,
	"successful_model_version_id" text GENERATED ALWAYS AS (case when document ? 'instances' then model_version_id end) STORED,
	"successful_artifact_digest" text GENERATED ALWAYS AS (case when document ? 'instances' then document->'producer'->>'artifact_digest' end) STORED,
	CONSTRAINT "inference_outcomes_image_id_model_version_id_pk" PRIMARY KEY("image_id","model_version_id"),
	CONSTRAINT "inference_outcomes_success_identity" UNIQUE("successful_image_id","successful_model_version_id","successful_artifact_digest"),
	CONSTRAINT "inference_outcomes_document_check" CHECK (document->'image'->>'digest' = "inference_outcomes"."image_id" and document->'producer'->>'model_version_id' = "inference_outcomes"."model_version_id"),
	CONSTRAINT "inference_outcomes_shape_check" CHECK (case "inference_outcomes"."status"
        when 'succeeded' then document ? 'instances' and not document ? 'error'
        when 'failed' then document ? 'error' and not document ? 'instances'
        else false
      end)
);
--> statement-breakpoint
CREATE TABLE "inference_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"runtimes" jsonb NOT NULL,
	"loaded_model_version_id" text,
	"current_image_id" text,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"image_id" text NOT NULL,
	"model_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"status" text GENERATED ALWAYS AS (document->>'status') STORED NOT NULL,
	"revision" integer GENERATED ALWAYS AS ((document->>'revision')::integer) STORED NOT NULL,
	"source_model_version_id" text GENERATED ALWAYS AS (document->'source'->>'modelVersionId') STORED NOT NULL,
	"source_artifact_digest" text GENERATED ALWAYS AS (document->'source'->>'artifactDigest') STORED NOT NULL,
	CONSTRAINT "labels_image_id_model_id_pk" PRIMARY KEY("image_id","model_id"),
	CONSTRAINT "labels_status_check" CHECK ("labels"."status" in ('in_progress', 'complete', 'excluded')),
	CONSTRAINT "labels_revision_check" CHECK ("labels"."revision" >= 0),
	CONSTRAINT "labels_image_check" CHECK (document->'image'->>'digest' = "labels"."image_id")
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"source" jsonb NOT NULL,
	"artifact" jsonb NOT NULL,
	"artifact_digest" text GENERATED ALWAYS AS (artifact->>'digest') STORED NOT NULL,
	"source_kind" text GENERATED ALWAYS AS (source->>'kind') STORED NOT NULL,
	"source_training_run_id" text GENERATED ALWAYS AS (source->>'trainingRunId') STORED,
	"source_training_attempt" integer GENERATED ALWAYS AS ((source->>'trainingAttempt')::integer) STORED,
	"source_dataset_snapshot_id" text GENERATED ALWAYS AS (source->>'datasetSnapshotId') STORED,
	"artifact_kind" text GENERATED ALWAYS AS (artifact->>'kind') STORED NOT NULL,
	"weights_digest" text GENERATED ALWAYS AS (artifact->'weights'->>'digest') STORED,
	"weights_bytes" integer GENERATED ALWAYS AS ((artifact->'weights'->>'bytes')::integer) STORED,
	CONSTRAINT "model_versions_id_model" UNIQUE("id","model_id"),
	CONSTRAINT "model_versions_id_digest" UNIQUE("id","artifact_digest"),
	CONSTRAINT "model_versions_publication_identity" UNIQUE("id","source_training_run_id","source_training_attempt","source_dataset_snapshot_id","model_id"),
	CONSTRAINT "model_versions_digest_check" CHECK ("model_versions"."artifact_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "model_versions_source_artifact_check" CHECK (case "model_versions"."source_kind"
        when 'builtin' then "model_versions"."artifact_kind" = 'traditional' and "model_versions"."source_training_run_id" is null and "model_versions"."source_training_attempt" is null and "model_versions"."source_dataset_snapshot_id" is null and "model_versions"."weights_digest" is null and "model_versions"."weights_bytes" is null
        when 'training_run' then "model_versions"."artifact_kind" = 'ultralytics' and "model_versions"."source_training_run_id" is not null and "model_versions"."source_training_attempt" >= 1 and "model_versions"."source_dataset_snapshot_id" is not null and "model_versions"."weights_digest" ~ '^[0-9a-f]{64}$' and "model_versions"."weights_bytes" > 0
        else false
      end)
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"task" text NOT NULL,
	"classes" jsonb NOT NULL,
	"readings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_epochs" (
	"run_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"epoch" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"train_box_loss" double precision NOT NULL,
	"train_classification_loss" double precision NOT NULL,
	"train_regression_loss" double precision NOT NULL,
	"val_box_loss" double precision NOT NULL,
	"val_classification_loss" double precision NOT NULL,
	"val_regression_loss" double precision NOT NULL,
	"precision" double precision NOT NULL,
	"recall" double precision NOT NULL,
	"map50" double precision NOT NULL,
	"map50_95" double precision NOT NULL,
	"fitness" double precision NOT NULL,
	"learning_rate" double precision NOT NULL,
	CONSTRAINT "training_epochs_run_id_attempt_epoch_pk" PRIMARY KEY("run_id","attempt","epoch"),
	CONSTRAINT "training_epochs_order_check" CHECK ("training_epochs"."attempt" >= 1 and "training_epochs"."epoch" >= 1)
);
--> statement-breakpoint
CREATE TABLE "training_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"dataset_snapshot_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"attempt" integer NOT NULL,
	"recipe" jsonb NOT NULL,
	"status" text NOT NULL,
	"worker_id" text,
	"session_id" text,
	"lease_expires_at" timestamp with time zone,
	"phase" text,
	"progress" real,
	"error" text,
	"model_version_id" text,
	CONSTRAINT "training_runs_attempt_check" CHECK ("training_runs"."attempt" >= 0),
	CONSTRAINT "training_runs_state_check" CHECK (case "training_runs"."status"
        when 'queued' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'running' then "training_runs"."worker_id" is not null and "training_runs"."session_id" is not null and "training_runs"."lease_expires_at" is not null and "training_runs"."phase" in ('preparing', 'training', 'validating') and "training_runs"."progress" is not null and "training_runs"."progress" between 0 and 1 and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'succeeded' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is not null
        when 'failed' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and length("training_runs"."error") between 1 and 2000 and "training_runs"."model_version_id" is null
        else false
      end)
);
--> statement-breakpoint
CREATE TABLE "training_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"device" text NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"current_training_run_id" text,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_snapshot_id_model_id_dataset_snapshots_id_model_id_fk" FOREIGN KEY ("snapshot_id","model_id") REFERENCES "public"."dataset_snapshots"("id","model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_source_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("source_model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk" FOREIGN KEY ("image_id","source_model_version_id","source_artifact_digest") REFERENCES "public"."inference_outcomes"("successful_image_id","successful_model_version_id","successful_artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_dataset_id_model_id_datasets_id_model_id_fk" FOREIGN KEY ("dataset_id","model_id") REFERENCES "public"."datasets"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_dishes" ADD CONSTRAINT "experiment_dishes_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_dishes" ADD CONSTRAINT "experiment_dishes_experiment_id_treatment_id_experiment_treatments_experiment_id_id_fk" FOREIGN KEY ("experiment_id","treatment_id") REFERENCES "public"."experiment_treatments"("experiment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_photos" ADD CONSTRAINT "experiment_photos_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_photos" ADD CONSTRAINT "experiment_photos_experiment_id_dish_label_experiment_dishes_experiment_id_label_fk" FOREIGN KEY ("experiment_id","dish_label") REFERENCES "public"."experiment_dishes"("experiment_id","label") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_photos" ADD CONSTRAINT "experiment_photos_experiment_id_round_id_experiment_rounds_experiment_id_id_fk" FOREIGN KEY ("experiment_id","round_id") REFERENCES "public"."experiment_rounds"("experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_rounds" ADD CONSTRAINT "experiment_rounds_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD CONSTRAINT "inference_outcomes_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD CONSTRAINT "inference_outcomes_model_version_id_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("model_version_id","artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_workers" ADD CONSTRAINT "inference_workers_loaded_model_version_id_model_versions_id_fk" FOREIGN KEY ("loaded_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_workers" ADD CONSTRAINT "inference_workers_current_image_id_images_id_fk" FOREIGN KEY ("current_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_source_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("source_model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_source_model_version_id_source_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("source_model_version_id","source_artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk" FOREIGN KEY ("image_id","source_model_version_id","source_artifact_digest") REFERENCES "public"."inference_outcomes"("successful_image_id","successful_model_version_id","successful_artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_source_training_run_id_training_runs_id_fk" FOREIGN KEY ("source_training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_source_dataset_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("source_dataset_snapshot_id") REFERENCES "public"."dataset_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_epochs" ADD CONSTRAINT "training_epochs_run_id_training_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_dataset_snapshot_id_model_id_dataset_snapshots_id_model_id_fk" FOREIGN KEY ("dataset_snapshot_id","model_id") REFERENCES "public"."dataset_snapshots"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_version_id_id_attempt_dataset_snapshot_id_model_id_model_versions_id_source_training_run_id_source_training_attempt_source_dataset_snapshot_id_model_id_fk" FOREIGN KEY ("model_version_id","id","attempt","dataset_snapshot_id","model_id") REFERENCES "public"."model_versions"("id","source_training_run_id","source_training_attempt","source_dataset_snapshot_id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workers" ADD CONSTRAINT "training_workers_current_training_run_id_training_runs_id_fk" FOREIGN KEY ("current_training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_images_image_idx" ON "dataset_images" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_images_image_idx" ON "dataset_snapshot_images" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_dataset_idx" ON "dataset_snapshots" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "experiment_dishes_treatment_idx" ON "experiment_dishes" USING btree ("experiment_id","treatment_id");--> statement-breakpoint
CREATE INDEX "experiment_photos_image_idx" ON "experiment_photos" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "experiment_rounds_captured_idx" ON "experiment_rounds" USING btree ("experiment_id","captured_at","id");--> statement-breakpoint
CREATE INDEX "experiments_version_idx" ON "experiments" USING btree ("model_version_id");--> statement-breakpoint
CREATE INDEX "images_received_idx" ON "images" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "inference_outcomes_version_idx" ON "inference_outcomes" USING btree ("model_version_id");--> statement-breakpoint
CREATE INDEX "inference_outcomes_status_idx" ON "inference_outcomes" USING btree ("status","recorded_at");--> statement-breakpoint
CREATE INDEX "inference_workers_seen_idx" ON "inference_workers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "labels_model_status_idx" ON "labels" USING btree ("model_id","status");--> statement-breakpoint
CREATE INDEX "model_versions_model_idx" ON "model_versions" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_runs_one_active_per_model" ON "training_runs" USING btree ("model_id") WHERE "training_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "training_runs_model_idx" ON "training_runs" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_claimable_idx" ON "training_runs" USING btree ("created_at") WHERE "training_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "training_workers_seen_idx" ON "training_workers" USING btree ("last_seen_at");