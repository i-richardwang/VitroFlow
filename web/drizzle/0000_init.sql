CREATE TABLE "annotations" (
	"image_id" text NOT NULL,
	"model_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"status" text GENERATED ALWAYS AS (document->>'status') STORED NOT NULL,
	"revision" integer GENERATED ALWAYS AS ((document->>'revision')::integer) STORED NOT NULL,
	"source_model_version_id" text GENERATED ALWAYS AS (document->'source'->>'modelVersionId') STORED NOT NULL,
	"source_artifact_digest" text GENERATED ALWAYS AS (document->'source'->>'artifactDigest') STORED NOT NULL,
	CONSTRAINT "annotations_image_id_model_id_pk" PRIMARY KEY("image_id","model_id"),
	CONSTRAINT "annotations_status_check" CHECK ("annotations"."status" in ('in_progress', 'complete', 'excluded')),
	CONSTRAINT "annotations_revision_check" CHECK ("annotations"."revision" >= 0),
	CONSTRAINT "annotations_image_check" CHECK (document->'image'->>'digest' = "annotations"."image_id")
);
--> statement-breakpoint
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
CREATE TABLE "experiment_culture_events" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"observation_unit_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"exclude_from_observation" boolean NOT NULL,
	"remove_after_observation" boolean NOT NULL,
	"note" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text NOT NULL,
	CONSTRAINT "experiment_culture_events_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_culture_events_note_check" CHECK ("experiment_culture_events"."note" = btrim("experiment_culture_events"."note") and length("experiment_culture_events"."note") <= 500),
	CONSTRAINT "experiment_culture_events_type_check" CHECK ("experiment_culture_events"."type" in ('contaminated', 'nonviable', 'discarded', 'harvested', 'missing')),
	CONSTRAINT "experiment_culture_events_void_check" CHECK (("experiment_culture_events"."voided_at" is null) = ("experiment_culture_events"."void_reason" = ''))
);
--> statement-breakpoint
CREATE TABLE "experiment_observation_images" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"observation_unit_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"image_id" text NOT NULL,
	"filename" text NOT NULL,
	CONSTRAINT "experiment_observation_images_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_observation_images_cell" UNIQUE("experiment_id","observation_unit_id","observation_id"),
	CONSTRAINT "experiment_observation_images_image" UNIQUE("experiment_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_observation_units" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"code_key" text GENERATED ALWAYS AS (trim(both '-' from lower(regexp_replace(normalize(code, NFKC), '[-[:space:]._]+', '-', 'g')))) STORED NOT NULL,
	"treatment_id" uuid,
	"initial_explant_count" integer NOT NULL,
	CONSTRAINT "experiment_observation_units_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_observation_units_code" UNIQUE("experiment_id","code_key"),
	CONSTRAINT "experiment_observation_units_code_check" CHECK ("experiment_observation_units"."code" = btrim("experiment_observation_units"."code") and length("experiment_observation_units"."code") between 1 and 60 and "experiment_observation_units"."code_key" <> ''),
	CONSTRAINT "experiment_observation_units_initial_explant_count_check" CHECK ("experiment_observation_units"."initial_explant_count" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "experiment_observations" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"inoculated_on" date NOT NULL,
	"observed_on" date NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experiment_observations_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_observations_day" UNIQUE("experiment_id","observed_on"),
	CONSTRAINT "experiment_observations_note_check" CHECK ("experiment_observations"."note" = btrim("experiment_observations"."note") and length("experiment_observations"."note") <= 500),
	CONSTRAINT "experiment_observations_date_check" CHECK ("experiment_observations"."observed_on" >= "experiment_observations"."inoculated_on")
);
--> statement-breakpoint
CREATE TABLE "experiment_treatments" (
	"experiment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text GENERATED ALWAYS AS (trim(both '-' from lower(regexp_replace(normalize(name, NFKC), '[-[:space:]._]+', '-', 'g')))) STORED NOT NULL,
	"factors" jsonb NOT NULL,
	"note" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "experiment_treatments_experiment_id_id_pk" PRIMARY KEY("experiment_id","id"),
	CONSTRAINT "experiment_treatments_name" UNIQUE("experiment_id","name_key"),
	CONSTRAINT "experiment_treatments_position" UNIQUE("experiment_id","position"),
	CONSTRAINT "experiment_treatments_name_check" CHECK ("experiment_treatments"."name" = btrim("experiment_treatments"."name") and length("experiment_treatments"."name") between 1 and 120 and "experiment_treatments"."name_key" <> ''),
	CONSTRAINT "experiment_treatments_note_check" CHECK ("experiment_treatments"."note" = btrim("experiment_treatments"."note") and length("experiment_treatments"."note") <= 1000),
	CONSTRAINT "experiment_treatments_factors_check" CHECK (jsonb_typeof("experiment_treatments"."factors") = 'array' and jsonb_array_length("experiment_treatments"."factors") <= 12),
	CONSTRAINT "experiment_treatments_position_check" CHECK ("experiment_treatments"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plant_material" text NOT NULL,
	"explant_type" text NOT NULL,
	"base_medium" text NOT NULL,
	"notes" text NOT NULL,
	"inoculated_on" date NOT NULL,
	"model_version_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experiments_id_inoculated" UNIQUE("id","inoculated_on"),
	CONSTRAINT "experiments_name_check" CHECK ("experiments"."name" = btrim("experiments"."name") and length("experiments"."name") between 1 and 120),
	CONSTRAINT "experiments_plant_material_check" CHECK ("experiments"."plant_material" = btrim("experiments"."plant_material") and length("experiments"."plant_material") <= 120),
	CONSTRAINT "experiments_explant_type_check" CHECK ("experiments"."explant_type" = btrim("experiments"."explant_type") and length("experiments"."explant_type") <= 120),
	CONSTRAINT "experiments_base_medium_check" CHECK ("experiments"."base_medium" = btrim("experiments"."base_medium") and length("experiments"."base_medium") <= 200),
	CONSTRAINT "experiments_notes_check" CHECK ("experiments"."notes" = btrim("experiments"."notes") and length("experiments"."notes") <= 2000)
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
	"artifact_digest" text GENERATED ALWAYS AS (document->'producer'->>'artifactDigest') STORED NOT NULL,
	"successful_image_id" text GENERATED ALWAYS AS (case when document ? 'instances' then image_id end) STORED,
	"successful_model_version_id" text GENERATED ALWAYS AS (case when document ? 'instances' then model_version_id end) STORED,
	"successful_artifact_digest" text GENERATED ALWAYS AS (case when document ? 'instances' then document->'producer'->>'artifactDigest' end) STORED,
	CONSTRAINT "inference_outcomes_image_id_model_version_id_pk" PRIMARY KEY("image_id","model_version_id"),
	CONSTRAINT "inference_outcomes_success_identity" UNIQUE("successful_image_id","successful_model_version_id","successful_artifact_digest"),
	CONSTRAINT "inference_outcomes_document_check" CHECK (document->'image'->>'digest' = "inference_outcomes"."image_id" and document->'producer'->>'modelVersionId' = "inference_outcomes"."model_version_id"),
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
	"metrics" jsonb NOT NULL
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
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_source_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("source_model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_source_model_version_id_source_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("source_model_version_id","source_artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk" FOREIGN KEY ("image_id","source_model_version_id","source_artifact_digest") REFERENCES "public"."inference_outcomes"("successful_image_id","successful_model_version_id","successful_artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_images" ADD CONSTRAINT "dataset_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_snapshot_id_model_id_dataset_snapshots_id_model_id_fk" FOREIGN KEY ("snapshot_id","model_id") REFERENCES "public"."dataset_snapshots"("id","model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_source_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("source_model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" ADD CONSTRAINT "dataset_snapshot_images_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk" FOREIGN KEY ("image_id","source_model_version_id","source_artifact_digest") REFERENCES "public"."inference_outcomes"("successful_image_id","successful_model_version_id","successful_artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_dataset_id_model_id_datasets_id_model_id_fk" FOREIGN KEY ("dataset_id","model_id") REFERENCES "public"."datasets"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_culture_events" ADD CONSTRAINT "experiment_culture_events_experiment_id_observation_unit_id_experiment_observation_units_experiment_id_id_fk" FOREIGN KEY ("experiment_id","observation_unit_id") REFERENCES "public"."experiment_observation_units"("experiment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_culture_events" ADD CONSTRAINT "experiment_culture_events_experiment_id_observation_id_experiment_observations_experiment_id_id_fk" FOREIGN KEY ("experiment_id","observation_id") REFERENCES "public"."experiment_observations"("experiment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observation_images" ADD CONSTRAINT "experiment_observation_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observation_images" ADD CONSTRAINT "experiment_observation_images_experiment_id_observation_unit_id_experiment_observation_units_experiment_id_id_fk" FOREIGN KEY ("experiment_id","observation_unit_id") REFERENCES "public"."experiment_observation_units"("experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observation_images" ADD CONSTRAINT "experiment_observation_images_experiment_id_observation_id_experiment_observations_experiment_id_id_fk" FOREIGN KEY ("experiment_id","observation_id") REFERENCES "public"."experiment_observations"("experiment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observation_units" ADD CONSTRAINT "experiment_observation_units_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observation_units" ADD CONSTRAINT "experiment_observation_units_experiment_id_treatment_id_experiment_treatments_experiment_id_id_fk" FOREIGN KEY ("experiment_id","treatment_id") REFERENCES "public"."experiment_treatments"("experiment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_observations" ADD CONSTRAINT "experiment_observations_experiment_id_inoculated_on_experiments_id_inoculated_on_fk" FOREIGN KEY ("experiment_id","inoculated_on") REFERENCES "public"."experiments"("id","inoculated_on") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD CONSTRAINT "inference_outcomes_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD CONSTRAINT "inference_outcomes_model_version_id_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("model_version_id","artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_workers" ADD CONSTRAINT "inference_workers_loaded_model_version_id_model_versions_id_fk" FOREIGN KEY ("loaded_model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_workers" ADD CONSTRAINT "inference_workers_current_image_id_images_id_fk" FOREIGN KEY ("current_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_source_training_run_id_training_runs_id_fk" FOREIGN KEY ("source_training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_source_dataset_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("source_dataset_snapshot_id") REFERENCES "public"."dataset_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_epochs" ADD CONSTRAINT "training_epochs_run_id_training_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_dataset_snapshot_id_model_id_dataset_snapshots_id_model_id_fk" FOREIGN KEY ("dataset_snapshot_id","model_id") REFERENCES "public"."dataset_snapshots"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_version_id_id_attempt_dataset_snapshot_id_model_id_model_versions_id_source_training_run_id_source_training_attempt_source_dataset_snapshot_id_model_id_fk" FOREIGN KEY ("model_version_id","id","attempt","dataset_snapshot_id","model_id") REFERENCES "public"."model_versions"("id","source_training_run_id","source_training_attempt","source_dataset_snapshot_id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workers" ADD CONSTRAINT "training_workers_current_training_run_id_training_runs_id_fk" FOREIGN KEY ("current_training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_model_status_idx" ON "annotations" USING btree ("model_id","status");--> statement-breakpoint
CREATE INDEX "dataset_images_image_idx" ON "dataset_images" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_images_image_idx" ON "dataset_snapshot_images" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_dataset_idx" ON "dataset_snapshots" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "experiment_culture_events_unit_idx" ON "experiment_culture_events" USING btree ("experiment_id","observation_unit_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_culture_events_one_active_kind" ON "experiment_culture_events" USING btree ("experiment_id","observation_unit_id","observation_id","type") WHERE "experiment_culture_events"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "experiment_observation_images_image_idx" ON "experiment_observation_images" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "experiment_observation_units_treatment_idx" ON "experiment_observation_units" USING btree ("experiment_id","treatment_id");--> statement-breakpoint
CREATE INDEX "experiment_observations_observed_idx" ON "experiment_observations" USING btree ("experiment_id","observed_on");--> statement-breakpoint
CREATE INDEX "experiments_version_idx" ON "experiments" USING btree ("model_version_id");--> statement-breakpoint
CREATE INDEX "images_received_idx" ON "images" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "inference_outcomes_version_idx" ON "inference_outcomes" USING btree ("model_version_id");--> statement-breakpoint
CREATE INDEX "inference_outcomes_status_idx" ON "inference_outcomes" USING btree ("status","recorded_at");--> statement-breakpoint
CREATE INDEX "inference_workers_seen_idx" ON "inference_workers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "model_versions_model_idx" ON "model_versions" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_runs_one_active_per_model" ON "training_runs" USING btree ("model_id") WHERE "training_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "training_runs_model_idx" ON "training_runs" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_claimable_idx" ON "training_runs" USING btree ("created_at") WHERE "training_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "training_workers_seen_idx" ON "training_workers" USING btree ("last_seen_at");