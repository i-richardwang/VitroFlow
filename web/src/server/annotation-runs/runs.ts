import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  annotationSchema,
  type AnnotationRef,
} from "../../domain/annotation/schema";
import {
  annotationAssignmentSchema,
  annotationRunResultSchema,
  type AnnotationRun,
  type AnnotationRunResult,
  type AnnotationRuntimeName,
  type StartAnnotationRun,
} from "../../domain/annotation-runs/schema";
import { assertInstanceClasses } from "../../domain/models/classes";
import { workerPresence } from "../../domain/workers/presence";
import type { WorkerIdentity } from "../../domain/workers/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { database, transaction, type Executor } from "../infra/db/client";
import { annotationRuns, images } from "../infra/db/schema";
import { lockImage } from "../images/public";
import { readModel } from "../models/public";
import {
  listWorkers,
  lockWorkerSession,
  sessionIsCurrent,
} from "../workers/public";

import {
  AnnotationRunConflictError,
  AnnotationRunNotFoundError,
} from "../../domain/annotation-runs/errors";
import { LEASE_EXPIRED, effectiveStatus } from "./readings";
const LEASE_MS = 5 * 60 * 1000;

function present(row: typeof annotationRuns.$inferSelect): AnnotationRun {
  return {
    id: row.id,
    ref: { digest: row.imageId, modelId: row.modelId },
    requestedBy: row.requestedBy,
    runtime: row.assignment.runtime,
    ...effectiveStatus(row),
    progress: { completed: row.completed, total: row.total },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    result: row.result,
  };
}

/** The agents some online Worker can run right now, in a stable order. */
export async function availableAnnotationRuntimes(): Promise<
  AnnotationRuntimeName[]
> {
  const names = new Set<AnnotationRuntimeName>();
  for (const worker of await listWorkers()) {
    if (workerPresence(worker.lastSeenAt) !== "online") continue;
    for (const runtime of worker.annotationRuntimes) names.add(runtime.runtime);
  }
  return [...names].sort();
}

/** Expired work fails explicitly; a new paid attempt requires a new request. */
async function expire(at: Date, db: Executor) {
  await db
    .update(annotationRuns)
    .set({
      status: "failed",
      updatedAt: at,
      error: LEASE_EXPIRED,
    })
    .where(
      and(
        eq(annotationRuns.status, "running"),
        lte(annotationRuns.leaseExpiresAt, at),
      ),
    );
}

export async function createAnnotationRun(
  request: StartAnnotationRun,
  requestedBy: string,
): Promise<AnnotationRun> {
  const available = await availableAnnotationRuntimes();
  return transaction(async (tx) => {
    await lockImage(request.ref.digest, tx);
    const [existing] = await tx
      .select()
      .from(annotationRuns)
      .where(eq(annotationRuns.id, request.id));
    if (existing) {
      if (
        existing.requestedBy !== requestedBy ||
        canonicalJson(existing.request) !== canonicalJson(request)
      )
        throw new AnnotationRunConflictError(
          "Request id already has different inputs",
        );
      return present(existing);
    }
    const now = new Date();
    await expire(now, tx);
    const [active] = await tx
      .select()
      .from(annotationRuns)
      .where(
        and(
          eq(annotationRuns.imageId, request.ref.digest),
          eq(annotationRuns.modelId, request.ref.modelId),
          inArray(annotationRuns.status, ["queued", "running"]),
        ),
      );
    if (active)
      throw new AnnotationRunConflictError(
        "This image already has an active AI annotation run",
      );
    const [image] = await tx
      .select()
      .from(images)
      .where(eq(images.id, request.ref.digest));
    const model = await readModel(request.ref.modelId, tx);
    if (!image || !model)
      throw new AnnotationRunNotFoundError("Image or labeling model not found");
    if (request.input) {
      annotationSchema.parse({
        schemaVersion: 1,
        image: { digest: image.id, width: image.width, height: image.height },
        instances: request.input,
      });
      assertInstanceClasses(
        model.classes,
        request.input,
        "AI annotation input",
      );
    }
    if (!available.includes(request.runtime))
      throw new AnnotationRunConflictError(
        "No online Worker provides the selected agent",
      );
    const { instructions, ...region } = model.annotation;
    if (!instructions)
      throw new AnnotationRunConflictError(
        "The model has no annotation instructions; add them on the Models page",
      );
    const assignment = annotationAssignmentSchema.parse({
      id: request.id,
      image: { digest: image.id, width: image.width, height: image.height },
      input: request.input,
      config: { classes: model.classes, rules: instructions, ...region },
      runtime: request.runtime,
    });
    const [row] = await tx
      .insert(annotationRuns)
      .values({
        id: request.id,
        imageId: image.id,
        modelId: model.id,
        requestedBy,
        request,
        assignment,
        status: "queued",
        total:
          Math.ceil(image.width / assignment.config.coreSize) *
          Math.ceil(image.height / assignment.config.coreSize),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return present(row!);
  });
}

/**
 * One run per image, from the image alone, skipping images an agent is
 * already working on. The count is how many were started.
 */
export async function createAnnotationRuns(
  refs: AnnotationRef[],
  runtime: AnnotationRuntimeName,
  requestedBy: string,
): Promise<number> {
  if (!refs.length) return 0;
  const db = await database();
  const active = await db
    .select({
      imageId: annotationRuns.imageId,
      modelId: annotationRuns.modelId,
    })
    .from(annotationRuns)
    .where(
      and(
        inArray(
          annotationRuns.imageId,
          refs.map((ref) => ref.digest),
        ),
        inArray(annotationRuns.status, ["queued", "running"]),
      ),
    );
  const busy = new Set(active.map((row) => `${row.imageId}/${row.modelId}`));
  let started = 0;
  for (const ref of refs) {
    if (busy.has(`${ref.digest}/${ref.modelId}`)) continue;
    await createAnnotationRun(
      { id: crypto.randomUUID(), ref, runtime, input: null },
      requestedBy,
    );
    started++;
  }
  return started;
}

export async function cancelAnnotationRun(id: string): Promise<void> {
  await transaction(async (tx) => {
    const now = new Date();
    await expire(now, tx);
    await tx
      .update(annotationRuns)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(annotationRuns.id, id),
          inArray(annotationRuns.status, ["queued", "running"]),
        ),
      );
  });
}

export async function claimAnnotationRun(
  owner: WorkerIdentity,
  at = new Date(),
) {
  return transaction(async (tx) => {
    const worker = await lockWorkerSession(owner, tx);
    await expire(at, tx);
    const runtimes = worker.annotationRuntimes.map((item) => item.runtime);
    if (!runtimes.length) return null;
    const [owned] = await tx
      .select()
      .from(annotationRuns)
      .where(
        and(
          eq(annotationRuns.workerId, owner.workerId),
          eq(annotationRuns.sessionId, owner.sessionId),
          eq(annotationRuns.status, "running"),
        ),
      );
    // A replayed HTTP claim returns the same assignment, never a second paid job.
    if (owned) return owned.assignment;
    const candidates = await tx
      .select()
      .from(annotationRuns)
      .where(
        and(
          eq(annotationRuns.status, "queued"),
          inArray(sql`${annotationRuns.assignment}->>'runtime'`, runtimes),
        ),
      )
      .orderBy(asc(annotationRuns.createdAt))
      .for("update", { skipLocked: true })
      .limit(1);
    const row = candidates[0];
    if (!row) return null;
    await tx
      .update(annotationRuns)
      .set({
        status: "running",
        workerId: owner.workerId,
        sessionId: owner.sessionId,
        leaseExpiresAt: new Date(at.getTime() + LEASE_MS),
        updatedAt: at,
      })
      .where(eq(annotationRuns.id, row.id));
    return row.assignment;
  });
}

function owned(id: string, owner: WorkerIdentity, at: Date) {
  return and(
    eq(annotationRuns.id, id),
    eq(annotationRuns.status, "running"),
    eq(annotationRuns.workerId, owner.workerId),
    eq(annotationRuns.sessionId, owner.sessionId),
    gt(annotationRuns.leaseExpiresAt, at),
    sessionIsCurrent(owner),
  );
}

export async function annotationRunImage(id: string, owner: WorkerIdentity) {
  const [row] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(owned(id, owner, new Date()));
  if (!row)
    throw new AnnotationRunConflictError(
      "AI annotation lease is no longer active",
    );
  return row.imageId;
}

export async function renewAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  at = new Date(),
) {
  const [row] = await (
    await database()
  )
    .update(annotationRuns)
    .set({ leaseExpiresAt: new Date(at.getTime() + LEASE_MS), updatedAt: at })
    .where(owned(id, owner, at))
    .returning();
  if (!row)
    throw new AnnotationRunConflictError(
      "AI annotation lease is no longer active",
    );
}

export async function progressAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  completed: number,
  total: number,
) {
  const [row] = await (
    await database()
  )
    .update(annotationRuns)
    .set({ completed, updatedAt: new Date() })
    .where(
      and(
        owned(id, owner, new Date()),
        eq(annotationRuns.total, total),
        lte(annotationRuns.completed, completed),
      ),
    )
    .returning();
  if (!row)
    throw new AnnotationRunConflictError(
      "Invalid progress or inactive AI annotation lease",
    );
}

export async function failAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  error: string,
) {
  const [row] = await (
    await database()
  )
    .update(annotationRuns)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(owned(id, owner, new Date()))
    .returning();
  if (!row)
    throw new AnnotationRunConflictError(
      "AI annotation lease is no longer active",
    );
}

export async function completeAnnotationRun(
  id: string,
  owner: WorkerIdentity,
  value: AnnotationRunResult,
) {
  const result = annotationRunResultSchema.parse(value);
  return transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(annotationRuns)
      .where(eq(annotationRuns.id, id))
      .for("update");
    if (!row)
      throw new AnnotationRunNotFoundError("AI annotation run not found");
    if (row.workerId !== owner.workerId || row.sessionId !== owner.sessionId)
      throw new AnnotationRunConflictError(
        "AI annotation has a different owner",
      );
    if (
      row.status === "succeeded" &&
      canonicalJson(row.result) === canonicalJson(result)
    )
      return;
    if (
      canonicalJson(result.document.image) !==
      canonicalJson(row.assignment.image)
    )
      throw new AnnotationRunConflictError(
        "Result describes a different image",
      );
    assertInstanceClasses(
      row.assignment.config.classes,
      result.document.instances,
      "AI annotation result",
    );
    if (result.execution.runtime !== row.assignment.runtime)
      throw new AnnotationRunConflictError(
        "Result was produced by a different agent",
      );
    const ids = new Set(
      result.document.instances.map((instance) => instance.id),
    );
    if (result.uncertainIds.some((id) => !ids.has(id)))
      throw new AnnotationRunConflictError("Unknown uncertain instance");
    for (const issue of result.issues) {
      const { x, y, width, height } = issue.bbox;
      if (
        x < 0 ||
        y < 0 ||
        x + width > row.assignment.image.width ||
        y + height > row.assignment.image.height
      )
        throw new AnnotationRunConflictError("Issue exceeds image bounds");
    }
    if (Object.keys(result.checkpointDigests).length !== row.total)
      throw new AnnotationRunConflictError("Incomplete task evidence");
    const [stored] = await tx
      .update(annotationRuns)
      .set({
        status: "succeeded",
        result,
        completed: row.total,
        updatedAt: new Date(),
      })
      .where(owned(id, owner, new Date()))
      .returning();
    if (!stored)
      throw new AnnotationRunConflictError(
        "AI annotation lease is no longer active",
      );
  });
}
