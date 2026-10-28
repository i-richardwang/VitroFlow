ALTER TABLE "experiment_observations" ADD COLUMN "counted_classes" jsonb;--> statement-breakpoint
UPDATE "experiment_observations" SET "counted_classes" = "models"."classes" FROM "models" WHERE "models"."id" = "experiment_observations"."model_id";--> statement-breakpoint
ALTER TABLE "experiment_observations" ALTER COLUMN "counted_classes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_observations" ADD CONSTRAINT "experiment_observations_counted_classes_check" CHECK (jsonb_typeof("experiment_observations"."counted_classes") = 'array' and jsonb_array_length("experiment_observations"."counted_classes") > 0);
