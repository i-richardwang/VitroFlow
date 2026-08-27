CREATE TABLE "dataset_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"images" jsonb NOT NULL,
	CONSTRAINT "dataset_snapshots_id_model" UNIQUE("id","model_id")
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"selected_model_version_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "datasets_model_id_unique" UNIQUE("model_id"),
	CONSTRAINT "datasets_id_model" UNIQUE("id","model_id")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"dataset_id" text NOT NULL,
	"stem" text NOT NULL,
	"extension" text NOT NULL,
	"bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"split" text,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "images_dataset_id_stem_pk" PRIMARY KEY("dataset_id","stem"),
	CONSTRAINT "images_bytes_check" CHECK ("images"."bytes" > 0),
	CONSTRAINT "images_digest_check" CHECK ("images"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "images_split_check" CHECK ("images"."split" is null or "images"."split" in ('train', 'val')),
	CONSTRAINT "images_extension_check" CHECK ("images"."extension" in ('.jpg', '.jpeg', '.png', '.tif', '.tiff'))
);
--> statement-breakpoint
CREATE TABLE "inference_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"model_version_id" text NOT NULL,
	"artifact_digest" text NOT NULL,
	"runtime" jsonb NOT NULL,
	"current" jsonb,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"dataset_id" text NOT NULL,
	"stem" text NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"status" text GENERATED ALWAYS AS (document->>'status') STORED NOT NULL,
	"revision" integer GENERATED ALWAYS AS ((document->>'revision')::integer) STORED NOT NULL,
	CONSTRAINT "labels_dataset_id_stem_pk" PRIMARY KEY("dataset_id","stem"),
	CONSTRAINT "labels_status_check" CHECK ("labels"."status" in ('in_progress', 'complete', 'excluded')),
	CONSTRAINT "labels_revision_check" CHECK ("labels"."revision" >= 0)
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
	CONSTRAINT "model_versions_id_model" UNIQUE("id","model_id"),
	CONSTRAINT "model_versions_id_digest" UNIQUE("id","artifact_digest"),
	CONSTRAINT "model_versions_digest_check" CHECK ("model_versions"."artifact_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"task" text NOT NULL,
	"classes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prelabels" (
	"dataset_id" text NOT NULL,
	"stem" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"model_version_id" text GENERATED ALWAYS AS (document->'producer'->>'model_version_id') STORED NOT NULL,
	"artifact_digest" text GENERATED ALWAYS AS (document->'producer'->>'artifact_digest') STORED NOT NULL,
	"error" text GENERATED ALWAYS AS (document->>'error') STORED,
	CONSTRAINT "prelabels_dataset_id_stem_pk" PRIMARY KEY("dataset_id","stem")
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
	"lease_expires_at" timestamp with time zone,
	"phase" text,
	"progress" real,
	"error" text,
	"model_version_id" text,
	CONSTRAINT "training_runs_attempt_check" CHECK ("training_runs"."attempt" >= 0),
	CONSTRAINT "training_runs_state_check" CHECK (case "training_runs"."status"
        when 'queued' then "training_runs"."worker_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'running' then "training_runs"."worker_id" is not null and "training_runs"."lease_expires_at" is not null and "training_runs"."phase" in ('preparing', 'training', 'validating') and "training_runs"."progress" is not null and "training_runs"."progress" between 0 and 1 and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'publishing' then "training_runs"."worker_id" is not null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'succeeded' then "training_runs"."worker_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is not null
        when 'failed' then "training_runs"."worker_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and length("training_runs"."error") between 1 and 2000 and "training_runs"."model_version_id" is null
        else false
      end)
);
--> statement-breakpoint
CREATE TABLE "training_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"device" text NOT NULL,
	"current_training_run_id" text,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_dataset_id_model_id_datasets_id_model_id_fk" FOREIGN KEY ("dataset_id","model_id") REFERENCES "public"."datasets"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_selected_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("selected_model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_workers" ADD CONSTRAINT "inference_workers_model_version_id_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("model_version_id","artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_dataset_id_stem_images_dataset_id_stem_fk" FOREIGN KEY ("dataset_id","stem") REFERENCES "public"."images"("dataset_id","stem") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prelabels" ADD CONSTRAINT "prelabels_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prelabels" ADD CONSTRAINT "prelabels_dataset_id_stem_images_dataset_id_stem_fk" FOREIGN KEY ("dataset_id","stem") REFERENCES "public"."images"("dataset_id","stem") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prelabels" ADD CONSTRAINT "prelabels_model_version_id_artifact_digest_model_versions_id_artifact_digest_fk" FOREIGN KEY ("model_version_id","artifact_digest") REFERENCES "public"."model_versions"("id","artifact_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_dataset_snapshot_id_model_id_dataset_snapshots_id_model_id_fk" FOREIGN KEY ("dataset_snapshot_id","model_id") REFERENCES "public"."dataset_snapshots"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_model_version_id_model_id_model_versions_id_model_id_fk" FOREIGN KEY ("model_version_id","model_id") REFERENCES "public"."model_versions"("id","model_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workers" ADD CONSTRAINT "training_workers_current_training_run_id_training_runs_id_fk" FOREIGN KEY ("current_training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_snapshots_dataset_idx" ON "dataset_snapshots" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_images_idx" ON "dataset_snapshots" USING gin ("images");--> statement-breakpoint
CREATE INDEX "datasets_selected_version_idx" ON "datasets" USING btree ("selected_model_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "images_dataset_stem_ci" ON "images" USING btree ("dataset_id",lower("stem"));--> statement-breakpoint
CREATE INDEX "inference_workers_seen_idx" ON "inference_workers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "labels_dataset_status_idx" ON "labels" USING btree ("dataset_id","status");--> statement-breakpoint
CREATE INDEX "model_versions_model_idx" ON "model_versions" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "prelabels_version_idx" ON "prelabels" USING btree ("model_version_id","artifact_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "training_runs_one_active_per_model" ON "training_runs" USING btree ("model_id") WHERE "training_runs"."status" in ('queued', 'running', 'publishing');--> statement-breakpoint
CREATE INDEX "training_runs_model_idx" ON "training_runs" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_claimable_idx" ON "training_runs" USING btree ("created_at") WHERE "training_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "training_workers_seen_idx" ON "training_workers" USING btree ("last_seen_at");
