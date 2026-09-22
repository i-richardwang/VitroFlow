import { savePreview, submitProposal } from "./tasks";
import {
  assignWorkerTask,
  workerAnnotationStatus,
  claimAnnotationRun,
} from "./worker";
import type { AnnotationRuntime } from "../../domain/annotation-runs/schema";
import type { WorkerIdentity } from "../../domain/workers/schema";
import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import type { StartAnnotationRun } from "../../domain/annotation-runs/schema";
import { readReview } from "../annotations/review";
import { createModel, setModelAnnotation } from "../models/public";
import { annotationRuns } from "../infra/db/schema";
import { database } from "../infra/db/client";
import { observeImages, signInAs, testHeartbeat } from "../testing/fixtures";
import { recordWorkerHeartbeat } from "../workers/sessions";
import {
  createAnnotationRun,
  cancelAnnotationRun,
  createAnnotationRuns,
} from "./runs";

async function finish(
  runId: string,
  owner: WorkerIdentity,
  runtime: AnnotationRuntime,
) {
  for (const task of (await workerAnnotationStatus(runId, owner)).tasks) {
    const binding = await assignWorkerTask(
      runId,
      owner,
      task.taskId,
      crypto.randomUUID(),
      runtime,
    );
    if (binding.accepted) continue;
    const principal = binding.principal;
    const preview = await savePreview(principal, task.taskId, {
      instances: [],
    });
    await submitProposal(principal, task.taskId, preview.proposalId);
  }
}

async function setup(name: string) {
  const { user } = await signInAs("member");
  const observed = await observeImages(name, [name, `${name}-other`]);
  const owner = { workerId: name, sessionId: `session-${name}` };
  const runtime = {
    runtime: "pi" as const,
    version: "0.85.1",
    model: "test/vision",
  };
  await recordWorkerHeartbeat({
    ...testHeartbeat(name),
    annotationRuntimes: [runtime],
  });
  const request = {
    id: `${name}-run`,
    ref: { digest: observed.digests[0]!, modelId: observed.version.modelId },
    executor: { kind: "worker", runtime: "pi" } as const,
    input: null,
  } satisfies StartAnnotationRun;
  return { user, owner, request, runtime, digests: observed.digests };
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
    createAnnotationRun({ ...request, ref }, user.id),
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
  const run = await createAnnotationRun({ ...request, ref }, user.id);
  expect(await claimAnnotationRun(owner)).toEqual({
    id: run.id,
    runtime: "pi",
  });
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, run.id));
  const definition = stored!.definition;
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
  await createAnnotationRun(request, user.id);
  await claimAnnotationRun(owner, new Date(Date.now() - 301000));
  const db = await database();
  const stored = () =>
    db.select().from(annotationRuns).where(eq(annotationRuns.id, request.id));
  const [before] = await stored();
  const visible = (await readReview(request.ref, "ai-read-only.jpg", db))
    ?.activity;
  expect(visible?.status).toBe("failed");
  expect(visible?.error).toContain("lease expired");
  expect(await stored()).toEqual([before!]);
  await createAnnotationRun({ ...request, id: "ai-read-only-next" }, user.id);
  expect((await stored())[0]?.status).toBe("failed");
  await cancelAnnotationRun("ai-read-only-next");
});

test("a run names an agent; any Worker that runs it may claim, and the result must come from it", async () => {
  const { user, owner, request, runtime } = await setup("ai-choice");
  const antigravity = {
    runtime: "antigravity" as const,
    version: "1.2.3",
    model: "default-vision",
  };
  await expect(
    createAnnotationRun(
      { ...request, executor: { kind: "worker", runtime: "antigravity" } },
      user.id,
    ),
  ).rejects.toThrow("No online Worker provides");
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime, antigravity],
  });
  const run = await createAnnotationRun(
    { ...request, executor: { kind: "worker", runtime: "antigravity" } },
    user.id,
  );
  expect(run.executor).toEqual({ kind: "worker", runtime: "antigravity" });
  await expect(createAnnotationRun(request, user.id)).rejects.toThrow(
    "different inputs",
  );
  // A Worker without the requested agent leaves the run for one that has it.
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime],
  });
  expect(await claimAnnotationRun(owner)).toBeNull();
  const other = { workerId: "ai-choice-other", sessionId: "session-other" };
  await recordWorkerHeartbeat({
    ...testHeartbeat(other.workerId),
    sessionId: other.sessionId,
    annotationRuntimes: [{ ...antigravity, version: "1.3.0" }],
  });
  const job = (await claimAnnotationRun(other))!;
  expect(job.runtime).toBe("antigravity");
  await expect(
    assignWorkerTask(
      run.id,
      other,
      `${run.id}/tile-000-000`,
      crypto.randomUUID(),
      runtime,
    ),
  ).rejects.toThrow("Wrong annotation runtime");
  await finish(run.id, other, { ...antigravity, version: "1.3.0" });
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, run.id));
  expect(stored?.status).toBe("succeeded");
  expect(stored?.runtime?.version).toBe("1.3.0");
});

test("a batch draws each image once, leaving images an agent is already reading", async () => {
  const { user, request, digests } = await setup("ai-batch");
  const second = { digest: digests[1]!, modelId: request.ref.modelId };
  await createAnnotationRun(request, user.id);
  expect(await createAnnotationRuns([request.ref, second], "pi", user.id)).toBe(
    1,
  );
  expect(await createAnnotationRuns([request.ref, second], "pi", user.id)).toBe(
    0,
  );
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
  await createAnnotationRun(request, user.id);
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
    createAnnotationRuns([request.ref, request.ref], "pi", user.id),
    createAnnotationRuns([request.ref], "pi", user.id),
  ]);
  expect(started.reduce((sum, count) => sum + count, 0)).toBe(1);
  const rows = await db
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.imageId, request.ref.digest));
  expect(rows.map((row) => row.status).sort()).toEqual(["failed", "queued"]);
  await cancelAnnotationRun(rows.find((row) => row.status === "queued")!.id);
});
