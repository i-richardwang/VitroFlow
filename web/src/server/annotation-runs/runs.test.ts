import { savePreview, submitProposal } from "./tasks";
import {
  assignWorkerTask,
  workerAnnotationStatus,
  claimAnnotationRun,
} from "./worker";
import type { WorkerIdentity } from "../../domain/workers/schema";
import { expect, test } from "bun:test";
import { eq, inArray, ne } from "drizzle-orm";
import type { StartAnnotationRun } from "../../domain/annotation-runs/schema";
import { readReview } from "../annotations/review";
import { createModel, setModelAnnotation } from "../models/public";
import { annotationRuns, workers } from "../infra/db/schema";
import { database } from "../infra/db/client";
import { observeImages, signInAs, testHeartbeat } from "../testing/fixtures";
import { recordWorkerHeartbeat } from "../workers/sessions";
import {
  createAnnotationRun,
  cancelAnnotationRun,
  createAnnotationRuns,
} from "./runs";
import { nextAnnotationTask } from "./tasks";
import { setInteractiveAnnotation } from "./interactive";

async function finish(runId: string, owner: WorkerIdentity) {
  for (const task of (await workerAnnotationStatus(runId, owner)).tasks) {
    const binding = await assignWorkerTask(
      runId,
      owner,
      task.taskId,
      crypto.randomUUID(),
    );
    if (binding.accepted) continue;
    const principal = binding.principal;
    const preview = await savePreview(principal, task.taskId, {
      instances: [],
    });
    await submitProposal(principal, task.taskId, preview.proposalId);
  }
}

async function stored(id: string) {
  const [row] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, id));
  return row!;
}

const pi = { runtime: "pi" as const, version: "0.85.1", model: "test/vision" };

async function setup(name: string) {
  const { user } = await signInAs("member");
  const observed = await observeImages(name, [name, `${name}-other`]);
  const owner = { workerId: name, sessionId: `session-${name}` };
  await recordWorkerHeartbeat({
    ...testHeartbeat(name),
    annotationRuntime: pi,
  });
  const request = {
    id: `${name}-run`,
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    input: null,
  } satisfies StartAnnotationRun;
  return { user, owner, request, digests: observed.digests };
}
test("the model's instructions and region are frozen into the run definition", async () => {
  const { user, owner, request, digests } = await setup("ai-region");
  const model = await createModel({
    id: "ai-region-model",
    name: "Region model",
    classes: ["seed"],
  });
  const ref = { digest: digests[0]!, modelId: model.id };
  await expect(
    createAnnotationRun({ ...request, ref }, "worker", user.id),
  ).rejects.toThrow("no annotation instructions");
  const annotation = {
    instructions: "Box every seed.",
    coreSize: 16,
    halo: 8,
    displayScale: 4,
  };
  await setModelAnnotation({ model: model.id, annotation });
  await expect(
    setModelAnnotation({
      model: model.id,
      annotation: { ...annotation, halo: 17 },
    }),
  ).rejects.toThrow("Context cannot exceed core size");
  const run = await createAnnotationRun({ ...request, ref }, "worker", user.id);
  expect(await claimAnnotationRun(owner)).toEqual({ id: run.id });
  const { definition } = await stored(run.id);
  expect(definition.config).toEqual({
    classes: ["seed"],
    rules: annotation.instructions,
    coreSize: 16,
    halo: 8,
    displayScale: 4,
  });
  expect(run.progress.total).toBe(
    Math.ceil(definition.image.width / 16) *
      Math.ceil(definition.image.height / 16),
  );
  await cancelAnnotationRun(run.id);
});
test("reading projects an expired lease without writing and a new request retires it", async () => {
  const { user, owner, request } = await setup("ai-read-only");
  await createAnnotationRun(request, "worker", user.id);
  await claimAnnotationRun(owner, new Date(Date.now() - 301000));
  const db = await database();
  const before = await stored(request.id);
  const visible = (await readReview(request.ref, "ai-read-only.jpg", db))
    ?.activity;
  expect(visible?.status).toBe("failed");
  expect(await stored(request.id)).toEqual(before);
  await createAnnotationRun(
    { ...request, id: "ai-read-only-next" },
    "worker",
    user.id,
  );
  expect((await stored(request.id)).status).toBe("failed");
  await cancelAnnotationRun("ai-read-only-next");
});

test("any Worker with an agent claims the oldest run, and the run keeps the agent it was claimed by", async () => {
  const { user, owner, request } = await setup("ai-claim");
  const bare = {
    workerId: "ai-claim-bare",
    sessionId: "session-ai-claim-bare",
  };
  await recordWorkerHeartbeat({
    ...testHeartbeat(bare.workerId),
    sessionId: bare.sessionId,
  });
  const run = await createAnnotationRun(request, "worker", user.id);
  expect(run.status).toBe("queued");
  await expect(
    createAnnotationRun({ ...request, input: [] }, "worker", user.id),
  ).rejects.toThrow("different inputs");
  expect(await claimAnnotationRun(bare)).toBeNull();
  expect(await claimAnnotationRun(owner)).toEqual({ id: run.id });
  expect(await claimAnnotationRun(owner)).toEqual({ id: run.id });
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntime: { ...pi, version: "0.86.0" },
  });
  await finish(run.id, owner);
  const row = await stored(run.id);
  expect(row.status).toBe("succeeded");
  expect(row.executor).toBe("worker");
  expect(row.runtime).toEqual(pi);
});

test("a Worker run needs an online agent", async () => {
  const { user, request } = await setup("ai-offline");
  // Every other Worker in the roster falls silent; this one runs no agent.
  await (
    await database()
  )
    .update(workers)
    .set({ lastSeenAt: new Date(0) })
    .where(ne(workers.id, "ai-offline"));
  await recordWorkerHeartbeat(testHeartbeat("ai-offline"));
  await expect(createAnnotationRun(request, "worker", user.id)).rejects.toThrow(
    "No AI annotation agent is online",
  );
  await expect(createAnnotationRuns([request.ref], user.id)).rejects.toThrow(
    "No AI annotation agent is online",
  );
});

test("an interactive run lives while its agent keeps calling and lapses when it stops", async () => {
  const { user, request } = await setup("ai-interactive-lease");
  const principal = { kind: "user" as const, userId: user.id, clientId: "c" };
  const run = await createAnnotationRun(request, "interactive", user.id);
  expect(run.status).toBe("running");
  const lapseIn = async (ms: number) =>
    (await database())
      .update(annotationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() + ms) })
      .where(eq(annotationRuns.id, run.id));
  await lapseIn(1000);
  await nextAnnotationTask(principal, run.id);
  expect((await stored(run.id)).leaseExpiresAt!.getTime()).toBeGreaterThan(
    Date.now() + 20 * 60 * 1000,
  );
  await expect(
    createAnnotationRun({ ...request, id: "ai-blocked" }, "worker", user.id),
  ).rejects.toThrow("already has an active");
  await lapseIn(-1000);
  expect(
    (await readReview(request.ref, "lease.jpg", await database()))?.activity
      ?.status,
  ).toBe("failed");
  await expect(nextAnnotationTask(principal, run.id)).rejects.toThrow(
    "stopped working",
  );
  const next = await createAnnotationRun(
    { ...request, id: "ai-after-lapse" },
    "worker",
    user.id,
  );
  expect(next.status).toBe("queued");
  expect((await stored(run.id)).status).toBe("failed");
  await cancelAnnotationRun(next.id);
});

test("turning interactive annotation off ends the runs connected agents hold, and only those", async () => {
  const { user, request, digests } = await setup("ai-interactive-off");
  const interactive = await createAnnotationRun(
    request,
    "interactive",
    user.id,
  );
  const scheduled = await createAnnotationRun(
    {
      id: "ai-interactive-off-worker",
      ref: { ...request.ref, digest: digests[1]! },
      input: null,
    },
    "worker",
    user.id,
  );
  await setInteractiveAnnotation(false);
  try {
    expect((await stored(interactive.id)).status).toBe("cancelled");
    expect((await stored(scheduled.id)).status).toBe("queued");
  } finally {
    await setInteractiveAnnotation(true);
    await cancelAnnotationRun(scheduled.id);
  }
});

test("a batch draws each image once, leaving images an agent is already reading", async () => {
  const { user, request, digests } = await setup("ai-batch");
  const second = { digest: digests[1]!, modelId: request.ref.modelId };
  await createAnnotationRun(request, "worker", user.id);
  expect(await createAnnotationRuns([request.ref, second], user.id)).toBe(1);
  expect(await createAnnotationRuns([request.ref, second], user.id)).toBe(0);
  const db = await database();
  const queued = await db
    .select({ id: annotationRuns.id, imageId: annotationRuns.imageId })
    .from(annotationRuns)
    .where(
      inArray(annotationRuns.imageId, [request.ref.digest, second.digest]),
    );
  expect(queued.map((row) => row.imageId).sort()).toEqual(
    [request.ref.digest, second.digest].sort(),
  );
  for (const run of queued) await cancelAnnotationRun(run.id);
});

test("batch admission retires expired work and admits each image only once", async () => {
  const { user, owner, request } = await setup("ai-expired-batch");
  await createAnnotationRun(request, "worker", user.id);
  const claimed = await claimAnnotationRun(
    owner,
    new Date(Date.now() - 301000),
  );
  expect(claimed?.id).toBe(request.id);
  const db = await database();
  expect(
    (await readReview(request.ref, "expired.jpg", db))?.activity?.status,
  ).toBe("failed");

  const started = await Promise.all([
    createAnnotationRuns([request.ref, request.ref], user.id),
    createAnnotationRuns([request.ref], user.id),
  ]);
  expect(started.reduce((sum, count) => sum + count, 0)).toBe(1);
  const rows = await db
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.imageId, request.ref.digest));
  expect(rows.map((row) => row.status).sort()).toEqual(["failed", "queued"]);
  await cancelAnnotationRun(rows.find((row) => row.status === "queued")!.id);
});
