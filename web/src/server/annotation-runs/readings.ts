import { sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AnnotationActivity,
  AnnotationProposal,
} from "../../domain/annotation-runs/schema";
import { annotationRuns } from "../infra/db/schema";

type Row = typeof annotationRuns.$inferSelect;

/** A run whose Worker stopped renewing its lease is back in the queue, whatever the row says. */
export function effectiveStatus(row: Row, at = new Date()) {
  return row.status === "running" && leaseLapsed(row, at)
    ? ("queued" as const)
    : row.status;
}

function leaseLapsed(row: Row, at: Date) {
  return (
    row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() <= at.getTime()
  );
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
    createdAt: row.createdAt.toISOString(),
    document: row.result.document,
    issues: row.result.issues,
    uncertainIds: row.result.uncertainIds,
  };
}

export function toActivity(row: Row | null): AnnotationActivity | null {
  if (!row) return null;
  const status = effectiveStatus(row);
  if (status === "succeeded" || status === "cancelled") return null;
  return {
    status,
    progress: { completed: row.completed, total: row.total },
  };
}
