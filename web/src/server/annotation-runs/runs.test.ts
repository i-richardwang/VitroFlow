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
import {
  cancelOwnAnnotationRun,
  nextAnnotationTask,
  savePreview,
  submitProposal,
} from "./tasks";
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
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    input: null,
    scope: null,
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
  await cancelAnnotationRun(ref);
});
test("a Worker that stops renewing lets go of its run, which another Worker finishes from the regions already accepted", async () => {
  const { user, owner, request } = await setup("ai-release");
  const model = await createModel({
    id: "ai-release-model",
    name: "Release model",
    classes: ["seed"],
  });
  await setModelAnnotation({
    model: model.id,
    annotation: {
      instructions: "Box every seed.",
      coreSize: 16,
      halo: 4,
      displayScale: 1,
    },
  });
  const ref = { ...request.ref, modelId: model.id };
  const run = await createAnnotationRun({ ...request, ref }, "worker", user.id);
  await claimAnnotationRun(owner);
  const [first, second] = (await workerAnnotationStatus(run.id, owner)).tasks;
  const accepted = await assignWorkerTask(
    run.id,
    owner,
    first!.taskId,
    crypto.randomUUID(),
  );
  if (accepted.accepted) throw new Error("Unexpected acceptance");
  const preview = await savePreview(accepted.principal, first!.taskId, {
    instances: [],
  });
  await submitProposal(accepted.principal, first!.taskId, preview.proposalId);
  const open = await assignWorkerTask(
    run.id,
    owner,
    second!.taskId,
    crypto.randomUUID(),
  );
  if (open.accepted) throw new Error("Unexpected acceptance");
  const db = await database();
  await db
    .update(annotationRuns)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(annotationRuns.id, run.id));
  const before = await stored(run.id);
  const activity = (await readReview(ref, "release.jpg", db))?.activity;
  expect(activity?.status).toBe("queued");
  expect(await stored(run.id)).toEqual(before);

  const other = {
    workerId: "ai-release-other",
    sessionId: "session-ai-release-other",
  };
  await recordWorkerHeartbeat({
    ...testHeartbeat(other.workerId),
    annotationRuntime: pi,
  });
  expect(await claimAnnotationRun(other)).toEqual({ id: run.id });
  await expect(
    savePreview(open.principal, second!.taskId, { instances: [] }),
  ).rejects.toThrow();
  const status = await workerAnnotationStatus(run.id, other);
  expect(status.completed).toBe(1);
  expect(status.tasks[0]!.accepted).toBe(true);
  await finish(run.id, other);
  const row = await stored(run.id);
  expect(row.status).toBe("succeeded");
  expect(row.workerId).toBe(other.workerId);
});

test("any Worker with an agent claims the oldest run", async () => {
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
  await expect(createAnnotationRun(request, "worker", user.id)).rejects.toThrow(
    "already has an AI annotation run in progress (0/",
  );
  expect(await claimAnnotationRun(bare)).toBeNull();
  expect(await claimAnnotationRun(owner)).toEqual({ id: run.id });
  expect(await claimAnnotationRun(owner)).toEqual({ id: run.id });
  await finish(run.id, owner);
  const row = await stored(run.id);
  expect(row.status).toBe("succeeded");
  expect(row.executor).toBe("worker");
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

test("an interactive run stays open without its agent, and any agent of the same person continues it by image", async () => {
  const { user, request } = await setup("ai-interactive-open");
  const principal = { kind: "user" as const, userId: user.id, clientId: "c" };
  const run = await createAnnotationRun(request, "interactive", user.id);
  expect(run.status).toBe("running");
  expect((await stored(run.id)).leaseExpiresAt).toBeNull();
  const next = await nextAnnotationTask(principal, request.ref);
  expect(next.taskId).toStartWith(`${run.id}/`);
  expect(
    await nextAnnotationTask({ ...principal, clientId: "d" }, request.ref),
  ).toEqual(next);
  const { user: stranger } = await signInAs("member");
  await expect(
    nextAnnotationTask(
      { kind: "user", userId: stranger.id, clientId: "c" },
      request.ref,
    ),
  ).rejects.toThrow("Another person");
  await expect(createAnnotationRun(request, "worker", user.id)).rejects.toThrow(
    "in progress",
  );
  await cancelOwnAnnotationRun(principal, request.ref);
  expect((await stored(run.id)).status).toBe("cancelled");
  await expect(nextAnnotationTask(principal, request.ref)).rejects.toThrow(
    "No AI annotation run is in progress",
  );
  await createAnnotationRun(request, "worker", user.id);
  await expect(nextAnnotationTask(principal, request.ref)).rejects.toThrow(
    "A Worker agent",
  );
  await cancelAnnotationRun(request.ref);
});

test("turning interactive annotation off ends the runs connected agents hold, and only those", async () => {
  const { user, request, digests } = await setup("ai-interactive-off");
  const interactive = await createAnnotationRun(
    request,
    "interactive",
    user.id,
  );
  const other = { ...request.ref, digest: digests[1]! };
  const scheduled = await createAnnotationRun(
    {
      ref: other,
      input: null,
      scope: null,
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
    await cancelAnnotationRun(other);
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
  for (const ref of [request.ref, second]) await cancelAnnotationRun(ref);
});

test("a batch skips an image whose lapsed run waits for the next Worker and admits each other image once", async () => {
  const { user, owner, request, digests } = await setup("ai-lapsed-batch");
  const run = await createAnnotationRun(request, "worker", user.id);
  expect(
    await claimAnnotationRun(owner, new Date(Date.now() - 301000)),
  ).toEqual({ id: run.id });
  const second = { digest: digests[1]!, modelId: request.ref.modelId };
  const started = await Promise.all([
    createAnnotationRuns([request.ref, second, second], user.id),
    createAnnotationRuns([second], user.id),
  ]);
  expect(started.reduce((sum, count) => sum + count, 0)).toBe(1);
  const db = await database();
  expect(
    (await readReview(request.ref, "lapsed.jpg", db))?.activity?.status,
  ).toBe("queued");
  const rows = await db
    .select()
    .from(annotationRuns)
    .where(
      inArray(annotationRuns.imageId, [request.ref.digest, second.digest]),
    );
  expect(rows).toHaveLength(2);
  for (const ref of [request.ref, second]) await cancelAnnotationRun(ref);
});
