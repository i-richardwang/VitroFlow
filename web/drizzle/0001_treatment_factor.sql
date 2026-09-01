ALTER TABLE "experiment_treatments" ADD COLUMN "factor" jsonb;--> statement-breakpoint
UPDATE "experiment_treatments" SET "factor" = CASE
	WHEN jsonb_typeof("factors") = 'array' AND jsonb_array_length("factors") >= 1 THEN "factors"->0
	ELSE NULL
END;--> statement-breakpoint
ALTER TABLE "experiment_treatments" DROP CONSTRAINT "experiment_treatments_factors_check";--> statement-breakpoint
ALTER TABLE "experiment_treatments" DROP COLUMN "factors";--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_factor_check" CHECK ("factor" IS NULL OR (
	jsonb_typeof("factor") = 'object'
	AND coalesce("factor"->>'name', '') <> ''
	AND coalesce("factor"->>'level', '') <> ''
	AND ("factor"->>'unit') IS NOT NULL
));
