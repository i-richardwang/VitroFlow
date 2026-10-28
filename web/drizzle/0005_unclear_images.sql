CREATE TABLE "unclear_images" (
	"image_id" text PRIMARY KEY NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unclear_images_note_check" CHECK (char_length("unclear_images"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "unclear_images" ADD CONSTRAINT "unclear_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unclear_images" ADD CONSTRAINT "unclear_images_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;