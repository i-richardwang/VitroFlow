import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { observeImages, signInAs, testHeartbeat } from "../testing/fixtures";
import { recordWorkerHeartbeat } from "../workers/public";
import { readAnnotation } from "../annotations/documents";
import { database } from "../infra/db/client";
import { annotationRuns } from "../infra/db/schema";
import { createModel, setModelAnnotation } from "../models/public";
import { createAnnotationRun, cancelAnnotationRun } from "./runs";
import { nextAnnotationTask, savePreview, submitProposal } from "./tasks";
import { readTask, validateTaskPrincipal } from "./access";
import { claimAnnotationRun, assignWorkerTask } from "./worker";
import { viewAnnotationTask, previewAnnotationTask } from "./views";
import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";

async function setup(name: string, scheduled = false) {
  const { user } = await signInAs("member");
  const observed = await observeImages(name, [name]);
  const ref = {
    digest: observed.digests[0]!,
    modelId: observed.version.modelId,
  };
  const owner = { workerId: name, sessionId: `session-${name}` };
  const runtime = {
    runtime: "pi" as const,
    version: "test",
    model: "test/vision",
  };
  if (scheduled)
    await recordWorkerHeartbeat({
      ...testHeartbeat(name),
      annotationRuntimes: [runtime],
    });
  const run = await createAnnotationRun(
    {
      id: crypto.randomUUID(),
      ref,
      input: null,
      executor: scheduled
        ? { kind: "worker", runtime: "pi" }
        : { kind: "interactive" },
    },
    user.id,
  );
  const principal: AnnotationPrincipal = {
    kind: "user",
    userId: user.id,
    clientId: "test-client",
  };
  return { run, principal, owner, runtime, ref };
}
const proposal = {
  instances: [{ id: "s1", class: "seed", box_2d: [100, 100, 300, 300] }],
};

test("interactive image-to-preview-to-submit is durable, idempotent and remains an unreviewed proposal", async () => {
  const { run, principal, ref } = await setup("remote-flow");
  const next = await nextAnnotationTask(principal, run.id);
  expect(await nextAnnotationTask(principal, run.id)).toEqual(next);
  const taskId = next.taskId!;
  const access = await readTask(principal, taskId);
  const content = await viewAnnotationTask(principal, taskId);
  const pictures = content.filter((i) => i.kind === "image");
  expect(pictures).toHaveLength(2);
  const dimensions = await sharp(pictures[1]!.bytes).metadata();
  expect(dimensions.width).toBe(
    access.task.region.patch.width * access.run.definition.config.displayScale,
  );
  expect((await nextAnnotationTask(principal, run.id)).completed).toBe(0);
  const preview = await previewAnnotationTask(principal, taskId, proposal);
  expect(preview.panels.filter((i) => i.kind === "image")).toHaveLength(2);
  const replies = await Promise.all([
    submitProposal(principal, taskId, preview.proposalId),
    submitProposal(principal, taskId, preview.proposalId),
  ]);
  expect(replies[0]).toEqual(replies[1]);
  expect(replies[0]?.status).toBe("succeeded");
  expect((await nextAnnotationTask(principal, run.id)).taskId).toBeNull();
  expect(await readAnnotation(ref)).toBeNull();
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, run.id));
  expect(stored!.result!.document.instances[0]!.bbox.x).toBe(
    access.run.definition.image.width * 0.1,
  );
  expect(stored!.executor).toEqual({ kind: "interactive" });
  expect(stored!.runtime).toBeNull();
  await expect(
    submitProposal(principal, taskId, "f".repeat(64)),
  ).rejects.toThrow("different proposal");
});

test("user ownership, classes, finite geometry and preview identity are enforced", async () => {
  const { run, principal } = await setup("remote-validation");
  const taskId = (await nextAnnotationTask(principal, run.id)).taskId!;
  await expect(
    nextAnnotationTask(
      { kind: "user", userId: "other", clientId: "client" },
      run.id,
    ),
  ).rejects.toThrow("not owned");
  await expect(
    savePreview(principal, taskId, {
      instances: [{ ...proposal.instances[0], class: "weed" }],
    }),
  ).rejects.toThrow("Unknown annotation class");
  await expect(
    savePreview(principal, taskId, {
      instances: [{ ...proposal.instances[0], box_2d: [100, 100, 1001, 300] }],
    }),
  ).rejects.toThrow();
  await expect(
    savePreview(principal, taskId, {
      instances: [proposal.instances[0], proposal.instances[0]],
    }),
  ).rejects.toThrow("Duplicate");
  await expect(
    submitProposal(principal, taskId, "a".repeat(64)),
  ).rejects.toThrow("preview first");
  await cancelAnnotationRun(run.id);
  await expect(readTask(principal, taskId)).rejects.toThrow("not active");
});

test("task credentials fence other regions, replaced attempts, cancellation, expiry and replaced Worker sessions", async () => {
  const { run, owner, runtime } = await setup("remote-fencing", true);
  await claimAnnotationRun(owner);
  const binding = await assignWorkerTask(
    run.id,
    owner,
    `${run.id}/tile-000-000`,
    crypto.randomUUID(),
    runtime,
  );
  if (binding.accepted) throw new Error("Unexpected acceptance");
  const principal = binding.principal;
  await validateTaskPrincipal(principal);
  await expect(nextAnnotationTask(principal, run.id)).rejects.toThrow(
    "Only user",
  );
  await expect(readTask(principal, "other")).rejects.toThrow();
  const preview = await savePreview(principal, principal.taskId, proposal);
  const newer = await assignWorkerTask(
    run.id,
    owner,
    principal.taskId,
    crypto.randomUUID(),
    runtime,
  );
  if (newer.accepted) throw new Error("Unexpected acceptance");
  await expect(
    submitProposal(principal, principal.taskId, preview.proposalId),
  ).rejects.toThrow("different region or attempt");
  const newPrincipal = newer.principal;
  await expect(
    submitProposal(newPrincipal, principal.taskId, preview.proposalId),
  ).rejects.toThrow("Unknown proposal");
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    sessionId: "replacement",
    startedAt: new Date().toISOString(),
    annotationRuntimes: [runtime],
  });
  await expect(validateTaskPrincipal(newPrincipal)).rejects.toThrow();
  await cancelAnnotationRun(run.id);
  await expect(validateTaskPrincipal(newPrincipal)).rejects.toThrow(
    "not active",
  );
});

test("all regions, including empty ones, must be accepted before finalization", async () => {
  const { run, principal, ref } = await setup("remote-multiregion");
  await cancelAnnotationRun(run.id);
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Regional annotation test",
    classes: ["seed"],
  });
  ref.modelId = model.id;
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      instructions: "Box all seeds",
      coreSize: 16,
      halo: 4,
      displayScale: 1,
    },
  });
  const second = await createAnnotationRun(
    {
      id: crypto.randomUUID(),
      ref,
      input: null,
      executor: { kind: "interactive" },
    },
    principal.kind === "user" ? principal.userId : "",
  );
  expect(second.progress.total).toBeGreaterThan(1);
  let completed = 0;
  for (;;) {
    const next = await nextAnnotationTask(principal, second.id);
    if (!next.taskId) break;
    const preview = await savePreview(principal, next.taskId, {
      instances: [],
    });
    const receipt = await submitProposal(
      principal,
      next.taskId,
      preview.proposalId,
    );
    completed++;
    expect(receipt.status).toBe(
      completed === second.progress.total ? "succeeded" : "running",
    );
  }
  expect(completed).toBe(second.progress.total);
});
