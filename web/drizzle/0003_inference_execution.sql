CREATE TABLE "inference_attempts" (
	"image_id" text NOT NULL,
	"model_version_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"worker_id" text NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"failure" jsonb,
	"result_digest" text,
	CONSTRAINT "inference_attempts_image_id_model_version_id_attempt_pk" PRIMARY KEY("image_id","model_version_id","attempt"),
	CONSTRAINT "inference_attempts_deadline_check" CHECK ("inference_attempts"."attempt" > 0 and "inference_attempts"."started_at" < "inference_attempts"."deadline_at" and "inference_attempts"."lease_expires_at" <= "inference_attempts"."deadline_at"),
	CONSTRAINT "inference_attempts_state_check" CHECK (case "inference_attempts"."status"
    when 'running' then "inference_attempts"."finished_at" is null and "inference_attempts"."failure" is null and "inference_attempts"."result_digest" is null
    when 'succeeded' then "inference_attempts"."finished_at" is not null and "inference_attempts"."failure" is null and "inference_attempts"."result_digest" is not null
    when 'failed' then "inference_attempts"."finished_at" is not null and "inference_attempts"."failure" is not null and "inference_attempts"."result_digest" is null
    else false end)
);
--> statement-breakpoint
CREATE TABLE "inference_tasks" (
	"image_id" text NOT NULL,
	"model_version_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"attempts_in_cycle" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "inference_tasks_image_id_model_version_id_pk" PRIMARY KEY("image_id","model_version_id"),
	CONSTRAINT "inference_tasks_attempt_check" CHECK ("inference_tasks"."attempt" >= "inference_tasks"."attempts_in_cycle" and "inference_tasks"."attempts_in_cycle" >= 0),
	CONSTRAINT "inference_tasks_state_check" CHECK (case "inference_tasks"."status"
    when 'queued' then "inference_tasks"."finished_at" is null
    when 'running' then "inference_tasks"."finished_at" is null and "inference_tasks"."attempt" > 0
    when 'succeeded' then "inference_tasks"."finished_at" is not null and "inference_tasks"."error" is null
    when 'failed' then "inference_tasks"."finished_at" is not null and length("inference_tasks"."error") > 0
    else false end)
);
--> statement-breakpoint
-- Historical results keep their identities. Failures belong to durable tasks.
INSERT INTO inference_tasks (image_id, model_version_id, status, created_at, available_at, finished_at, error)
SELECT image_id, model_version_id, status, recorded_at, recorded_at, recorded_at, document->>'error'
FROM inference_outcomes;
--> statement-breakpoint
INSERT INTO inference_tasks (image_id, model_version_id, status, attempt, created_at, available_at)
SELECT image_id, model_version_id, 'queued', attempt, now(), now() FROM inference_jobs
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM inference_outcomes WHERE status = 'failed';
--> statement-breakpoint
DROP TABLE "inference_jobs";--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP CONSTRAINT "inference_outcomes_shape_check";--> statement-breakpoint
DROP INDEX "inference_outcomes_status_idx";--> statement-breakpoint
ALTER TABLE "inference_attempts" ADD CONSTRAINT "inference_attempts_image_id_model_version_id_inference_tasks_image_id_model_version_id_fk" FOREIGN KEY ("image_id","model_version_id") REFERENCES "public"."inference_tasks"("image_id","model_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_tasks" ADD CONSTRAINT "inference_tasks_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_tasks" ADD CONSTRAINT "inference_tasks_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inference_attempts_one_per_worker" ON "inference_attempts" USING btree ("worker_id") WHERE "inference_attempts"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "inference_attempts_one_per_task" ON "inference_attempts" USING btree ("image_id","model_version_id") WHERE "inference_attempts"."status" = 'running';--> statement-breakpoint
CREATE INDEX "inference_attempts_expiry_idx" ON "inference_attempts" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "inference_tasks_ready_idx" ON "inference_tasks" USING btree ("status","available_at");--> statement-breakpoint
ALTER TABLE "inference_outcomes" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "inference_outcomes" ADD CONSTRAINT "inference_outcomes_shape_check" CHECK (document ? 'instances' and not document ? 'error');
--> statement-breakpoint
CREATE INDEX "inference_attempts_worker_failure_idx" ON "inference_attempts" USING btree ("worker_id","finished_at") WHERE "inference_attempts"."status" = 'failed';
