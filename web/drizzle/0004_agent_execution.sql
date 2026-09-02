CREATE TABLE "agent_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_kind" text NOT NULL,
	"credential_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_audit_events_principal_kind_check" CHECK ("agent_audit_events"."principal_kind" in ('api_key', 'mcp_client'))
);
--> statement-breakpoint
CREATE TABLE "agent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_kind" text NOT NULL,
	"credential_id" text NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_requests_principal_kind_check" CHECK ("agent_requests"."principal_kind" in ('api_key', 'mcp_client'))
);
--> statement-breakpoint
CREATE INDEX "agent_audit_events_user_occurred_idx" ON "agent_audit_events" USING btree ("user_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "agent_audit_events_operation_occurred_idx" ON "agent_audit_events" USING btree ("operation","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_requests_principal_key_idx" ON "agent_requests" USING btree ("principal_kind","credential_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "agent_requests_user_created_idx" ON "agent_requests" USING btree ("user_id","created_at");
