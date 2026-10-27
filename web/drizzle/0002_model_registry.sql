CREATE TABLE "model_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"weights_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"artifact_digest" text,
	"version_id" text
);
--> statement-breakpoint
ALTER TABLE "model_versions" DROP CONSTRAINT "model_versions_source_artifact_check";--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "weights_key" text;--> statement-breakpoint
ALTER TABLE "model_uploads" ADD CONSTRAINT "model_uploads_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_uploads" ADD CONSTRAINT "model_uploads_version_id_model_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_source_artifact_check" CHECK (case "model_versions"."source_kind"
        when 'builtin' then "model_versions"."artifact_kind" = 'traditional' and "model_versions"."source_training_run_id" is null and "model_versions"."source_training_attempt" is null and "model_versions"."source_dataset_snapshot_id" is null and "model_versions"."weights_digest" is null and "model_versions"."weights_bytes" is null
        when 'training_run' then "model_versions"."artifact_kind" = 'ultralytics' and "model_versions"."source_training_run_id" is not null and "model_versions"."source_training_attempt" >= 1 and "model_versions"."source_dataset_snapshot_id" is not null and "model_versions"."weights_digest" ~ '^[0-9a-f]{64}$' and "model_versions"."weights_bytes" > 0
        when 'import' then "model_versions"."artifact_kind" = 'ultralytics' and "model_versions"."source_training_run_id" is null and "model_versions"."source_training_attempt" is null and "model_versions"."source_dataset_snapshot_id" is null and "model_versions"."weights_digest" ~ '^[0-9a-f]{64}$' and "model_versions"."weights_bytes" > 0
        else false
      end);--> statement-breakpoint
UPDATE model_versions
SET weights_key = 'model-weights/' || source_training_run_id || '/' || source_training_attempt || '/' || weights_digest
WHERE artifact_kind = 'ultralytics';
