ALTER TABLE "annotations" DROP CONSTRAINT "annotations_source_model_version_id_model_id_model_versions_id_model_id_fk";
--> statement-breakpoint
ALTER TABLE "annotations" DROP CONSTRAINT "annotations_source_model_version_id_source_artifact_digest_model_versions_id_artifact_digest_fk";
--> statement-breakpoint
ALTER TABLE "annotations" DROP CONSTRAINT "annotations_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk";
--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" DROP CONSTRAINT "dataset_snapshot_images_source_model_version_id_model_id_model_versions_id_model_id_fk";
--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" DROP CONSTRAINT "dataset_snapshot_images_image_id_source_model_version_id_source_artifact_digest_inference_outcomes_successful_image_id_successful_model_version_id_successful_artifact_digest_fk";
--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP CONSTRAINT "inference_outcomes_success_identity";--> statement-breakpoint
ALTER TABLE "annotations" DROP COLUMN "source_model_version_id";--> statement-breakpoint
ALTER TABLE "annotations" DROP COLUMN "source_artifact_digest";--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" DROP COLUMN "source_model_version_id";--> statement-breakpoint
ALTER TABLE "dataset_snapshot_images" DROP COLUMN "source_artifact_digest";--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP COLUMN "successful_image_id";--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP COLUMN "successful_model_version_id";--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP COLUMN "successful_artifact_digest";--> statement-breakpoint
UPDATE "annotations" SET "document" = "document" - 'source' WHERE "document" ? 'source';--> statement-breakpoint
UPDATE "dataset_snapshot_images" SET "annotation" = "annotation" - 'source' WHERE "annotation" ? 'source';--> statement-breakpoint
UPDATE "api_keys"
SET "permissions" = (
	("permissions"::jsonb - 'export') ||
	jsonb_build_object('transfer', "permissions"::jsonb->'export')
)::text
WHERE "permissions" IS NOT NULL AND "permissions"::jsonb ? 'export';
