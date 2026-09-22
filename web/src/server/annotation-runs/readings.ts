import { sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AnnotationActivity,
  AnnotationProposal,
} from "../../domain/annotation-runs/schema";
import { annotationRuns } from "../infra/db/schema";

export const LEASE_EXPIRED = "Worker lease expired. Start a new run to retry.";

type Row = typeof annotationRuns.$inferSelect;

/** A running run whose Worker stopped renewing has failed, whatever the row says. */
export function effectiveStatus(row: Row, at = new Date()) {
  const expired =
    row.status === "running" &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt.getTime() <= at.getTime();
  return {
    status: expired ? ("failed" as const) : row.status,
    error: expired ? LEASE_EXPIRED : row.error,
  };
}

export const proposalRuns = alias(annotationRuns, "proposal_runs");
export const latestRuns = alias(annotationRuns, "latest_runs");

function newestRun(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
  succeeded: boolean,
) {
  return sql`(
    select r.id
    from annotation_runs r
    where r.image_id = ${imageId}
      and r.model_id = ${modelId}
      ${succeeded ? sql`and r.status = 'succeeded'` : sql``}
    order by r.created_at desc, r.id desc
    limit 1
  )`;
}

export function proposalRunId(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return newestRun(imageId, modelId, true);
}

export function latestRunId(imageId: SQLWrapper, modelId: SQLWrapper | string) {
  return newestRun(imageId, modelId, false);
}

export function toProposal(row: Row | null): AnnotationProposal | null {
  if (!row?.result) return null;
  return {
    runId: row.id,
    executor: row.executor,
    createdAt: row.createdAt.toISOString(),
    document: row.result.document,
    issues: row.result.issues,
    uncertainIds: row.result.uncertainIds,
  };
}

export function toActivity(row: Row | null): AnnotationActivity | null {
  if (!row) return null;
  const { status, error } = effectiveStatus(row);
  if (status === "succeeded" || status === "cancelled") return null;
  return {
    runId: row.id,
    executor: row.executor,
    status,
    progress: { completed: row.completed, total: row.total },
    error,
  };
}
