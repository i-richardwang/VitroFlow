CREATE TABLE "training_attempts" (
	"run_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"error" text,
	CONSTRAINT "training_attempts_run_id_attempt_pk" PRIMARY KEY("run_id","attempt"),
	CONSTRAINT "training_attempts_number_check" CHECK ("training_attempts"."attempt" >= 1),
	CONSTRAINT "training_attempts_outcome_check" CHECK (
      ("training_attempts"."finished_at" is null and "training_attempts"."outcome" is null and "training_attempts"."error" is null)
      or ("training_attempts"."finished_at" is not null and "training_attempts"."outcome" is not null and
        case "training_attempts"."outcome"
          when 'failed' then "training_attempts"."error" is not null and length("training_attempts"."error") between 1 and 2000
          when 'succeeded' then "training_attempts"."error" is null
          when 'paused' then "training_attempts"."error" is null
          when 'cancelled' then "training_attempts"."error" is null
          when 'expired' then "training_attempts"."error" is null
          else false
        end)
    )
);
--> statement-breakpoint
ALTER TABLE "training_runs" DROP CONSTRAINT "training_runs_state_check";--> statement-breakpoint
ALTER TABLE "training_runs" ADD COLUMN "target_worker_id" text;--> statement-breakpoint
ALTER TABLE "training_runs" ADD COLUMN "last_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_runs" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_run_id_training_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_attempts_active_idx" ON "training_attempts" USING btree ("run_id") WHERE "training_attempts"."finished_at" is null;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_state_check" CHECK (case "training_runs"."status"
        when 'queued' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'paused' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'cancelled' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'running' then "training_runs"."worker_id" is not null and "training_runs"."session_id" is not null and "training_runs"."lease_expires_at" is not null and "training_runs"."phase" in ('preparing', 'training', 'validating') and "training_runs"."progress" is not null and "training_runs"."progress" between 0 and 1 and "training_runs"."error" is null and "training_runs"."model_version_id" is null
        when 'succeeded' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and "training_runs"."error" is null and "training_runs"."model_version_id" is not null
        when 'failed' then "training_runs"."worker_id" is null and "training_runs"."session_id" is null and "training_runs"."lease_expires_at" is null and "training_runs"."phase" is null and "training_runs"."progress" is null and length("training_runs"."error") between 1 and 2000 and "training_runs"."model_version_id" is null
        else false
      end);
--> statement-breakpoint
INSERT INTO training_attempts (run_id, attempt, worker_id, started_at)
SELECT id, attempt, worker_id, created_at FROM training_runs WHERE status = 'running';
--> statement-breakpoint
UPDATE training_runs SET last_progress_at = COALESCE(
  (SELECT MAX(recorded_at) FROM training_epochs WHERE run_id = training_runs.id AND attempt = training_runs.attempt), created_at
) WHERE status = 'running';
