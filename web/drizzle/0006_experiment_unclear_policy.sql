ALTER TABLE "unclear_images" DROP CONSTRAINT "unclear_images_note_check";--> statement-breakpoint
ALTER TABLE "unclear_images" DROP CONSTRAINT "unclear_images_recorded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "counts_unclear" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unclear_images" DROP COLUMN "counted";--> statement-breakpoint
ALTER TABLE "unclear_images" DROP COLUMN "note";--> statement-breakpoint
ALTER TABLE "unclear_images" DROP COLUMN "recorded_by";--> statement-breakpoint
ALTER TABLE "unclear_images" DROP COLUMN "recorded_at";