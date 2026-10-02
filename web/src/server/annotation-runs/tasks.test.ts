import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import {
  observeImages,
  recordTestHeartbeat,
  signInAs,
  testHeartbeat,
} from "../testing/fixtures";
import { storeImage } from "../images/public";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import { readAnnotationReading } from "../readings/public";
import { database } from "../infra/db/client";
import { annotationRuns } from "../infra/db/schema";
import { createModel, setModelAnnotation } from "../models/public";
import { createAnnotationRun, cancelAnnotationRun } from "./runs";
import { nextAnnotationTask, savePreview, submitProposal } from "./tasks";
import { readTask, validateTaskPrincipal } from "./access";
import { claimAnnotationRun, assignWorkerTask } from "./worker";
import {
  readAnnotationContext,
  viewAnnotationTask,
  previewAnnotationTask,
} from "./views";
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
    await recordTestHeartbeat({
      ...testHeartbeat(name),
      annotationRuntime: runtime,
    });
  const run = await createAnnotationRun(
    { ref, input: null, scope: null },
    scheduled ? "worker" : "interactive",
    user.id,
  );
  const principal: AnnotationPrincipal = {
    kind: "user",
    userId: user.id,
    clientId: "test-client",
  };
  return { run, principal, owner, ref };
}
const proposal = {
  instances: [{ id: "s1", class: "seed", box_2d: [100, 100, 300, 300] }],
};

test("interactive image-to-preview-to-submit is durable, idempotent and remains an unreviewed proposal", async () => {
  const { run, principal, ref } = await setup("remote-flow");
  const next = await nextAnnotationTask(principal, ref);
  expect(await nextAnnotationTask(principal, ref)).toEqual(next);
  const taskId = next.taskId;
  const access = await readTask(principal, taskId);
  const context = await readAnnotationContext(principal, taskId);
  expect(context.filter((item) => item.kind === "image")).toHaveLength(1);
  expect(context[0]).toMatchObject({
    kind: "description",
    value: {
      contextId: run.id,
      classes: access.run.definition.config.classes,
      rules: access.run.definition.config.rules,
    },
  });
  const content = await viewAnnotationTask(principal, taskId);
  expect(content[0]).toMatchObject({
    kind: "description",
    value: {
      contextId: run.id,
      core: access.task.region.core,
      patch: access.task.region.patch,
    },
  });
  const pictures = content.filter((i) => i.kind === "image");
  expect(pictures).toHaveLength(1);
  const dimensions = await sharp(pictures[0]!.bytes).metadata();
  expect(dimensions.width).toBe(
    access.task.region.patch.width * access.run.definition.config.displayScale,
  );
  expect((await nextAnnotationTask(principal, ref)).completed).toBe(0);
  const preview = await previewAnnotationTask(principal, taskId, proposal);
  expect(preview.panels.filter((i) => i.kind === "image")).toHaveLength(2);
  const repeated = await previewAnnotationTask(principal, taskId, proposal);
  expect(repeated.proposalId).toBe(preview.proposalId);
  expect(repeated.panels.filter((i) => i.kind === "image")[1]!.bytes).toBe(
    preview.panels.filter((i) => i.kind === "image")[1]!.bytes,
  );
  await expect(
    readAnnotationContext({ ...principal, userId: "other" }, taskId),
  ).rejects.toThrow("not owned");
  await expect(
    viewAnnotationTask({ ...principal, userId: "other" }, taskId),
  ).rejects.toThrow("not owned");
  const replies = await Promise.all([
    submitProposal(principal, taskId, preview.proposalId),
    submitProposal(principal, taskId, preview.proposalId),
  ]);
  expect(replies[0]).toEqual(replies[1]);
  expect(replies[0]?.status).toBe("succeeded");
  await expect(nextAnnotationTask(principal, ref)).rejects.toThrow(
    "No AI annotation run is in progress",
  );
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
  expect(stored!.executor).toBe("interactive");
  await expect(
    submitProposal(principal, taskId, "f".repeat(64)),
  ).rejects.toThrow("different proposal");
});

test("user ownership, classes, finite geometry and preview identity are enforced", async () => {
  const { principal, ref } = await setup("remote-validation");
  const taskId = (await nextAnnotationTask(principal, ref)).taskId;
  await expect(
    nextAnnotationTask(
      { kind: "user", userId: "other", clientId: "client" },
      ref,
    ),
  ).rejects.toThrow("Another person");
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
  await cancelAnnotationRun(ref);
  await expect(readTask(principal, taskId)).rejects.toThrow("not active");
});

test("task credentials fence other regions, replaced attempts, cancellation, expiry and replaced Worker sessions", async () => {
  const { run, owner, ref } = await setup("remote-fencing", true);
  await claimAnnotationRun(owner);
  const binding = await assignWorkerTask(
    run.id,
    owner,
    `${run.id}/tile-000-000`,
    crypto.randomUUID(),
  );
  if (binding.accepted) throw new Error("Unexpected acceptance");
  const principal = binding.principal;
  await validateTaskPrincipal(principal);
  await readAnnotationContext(principal, principal.taskId);
  await expect(
    readAnnotationContext(principal, `${run.id}/tile-999-999`),
  ).rejects.toThrow();
  await expect(nextAnnotationTask(principal, ref)).rejects.toThrow("Only user");
  await expect(readTask(principal, "other")).rejects.toThrow();
  const preview = await savePreview(principal, principal.taskId, proposal);
  const newer = await assignWorkerTask(
    run.id,
    owner,
    principal.taskId,
    crypto.randomUUID(),
  );
  if (newer.accepted) throw new Error("Unexpected acceptance");
  await expect(
    submitProposal(principal, principal.taskId, preview.proposalId),
  ).rejects.toThrow("different region or attempt");
  await expect(
    readAnnotationContext(principal, principal.taskId),
  ).rejects.toThrow("different region or attempt");
  const newPrincipal = newer.principal;
  await expect(
    submitProposal(newPrincipal, principal.taskId, preview.proposalId),
  ).rejects.toThrow("Unknown proposal");
  await recordTestHeartbeat({
    ...testHeartbeat(owner.workerId),
    sessionId: "replacement",
    startedAt: new Date().toISOString(),
    annotationRuntime: {
      runtime: "pi",
      version: "test",
      model: "test/vision",
    },
  });
  await expect(validateTaskPrincipal(newPrincipal)).rejects.toThrow();
  await expect(
    readAnnotationContext(newPrincipal, newPrincipal.taskId),
  ).rejects.toThrow();
  await cancelAnnotationRun(ref);
  await expect(validateTaskPrincipal(newPrincipal)).rejects.toThrow(
    "not active",
  );
});

test("twenty regions reuse frozen context across views and reconnects before finalization", async () => {
  const { principal, ref } = await setup("remote-multiregion");
  await cancelAnnotationRun(ref);
  const source = await sharp({
    create: { width: 320, height: 16, channels: 3, background: "#aaa" },
  })
    .png()
    .toBuffer();
  ref.digest = (await storeImage(source)).digest;
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
    { ref, input: null, scope: null },
    "interactive",
    principal.kind === "user" ? principal.userId : "",
  );
  expect(second.progress.total).toBe(20);
  const firstTask = (await nextAnnotationTask(principal, ref)).taskId;
  const context = await readAnnotationContext(principal, firstTask);
  await setModelAnnotation({
    model: ref.modelId,
    annotation: {
      instructions: "Changed future rules",
      coreSize: 32,
      halo: 4,
      displayScale: 1,
    },
  });
  const reconnected = { ...principal, clientId: "another-conversation" };
  let completed = 0;
  let deliveredImages = context.filter((item) => item.kind === "image").length;
  for (let status = second.status; status === "running";) {
    const next = await nextAnnotationTask(principal, ref);
    const view = await viewAnnotationTask(principal, next.taskId);
    expect(view.filter((item) => item.kind === "image")).toHaveLength(1);
    expect(view[0]).toMatchObject({
      kind: "description",
      value: { contextId: second.id },
    });
    expect(
      JSON.stringify(view.filter((item) => item.kind === "description")),
    ).not.toContain("Box all seeds");
    const preview = await previewAnnotationTask(principal, next.taskId, {
      instances: [],
    });
    deliveredImages +=
      view.filter((item) => item.kind === "image").length +
      preview.panels.filter((item) => item.kind === "image").length;
    const receipt = await submitProposal(
      principal,
      next.taskId,
      preview.proposalId,
    );
    completed++;
    status = receipt.status;
    expect(receipt.status).toBe(
      completed === second.progress.total ? "succeeded" : "running",
    );
  }
  expect(completed).toBe(second.progress.total);
  expect(deliveredImages).toBe(61);
  expect(await readAnnotationContext(reconnected, firstTask)).toEqual(context);
  const later = await createAnnotationRun(
    { ref, input: null, scope: null },
    "interactive",
    principal.kind === "user" ? principal.userId : "",
  );
  const laterTask = (await nextAnnotationTask(principal, ref)).taskId;
  expect(later.id).not.toBe(second.id);
  expect(
    (await readAnnotationContext(reconnected, laterTask))[0],
  ).toMatchObject({
    kind: "description",
    value: { contextId: later.id, rules: "Changed future rules" },
  });
  await cancelAnnotationRun(ref);
});

test("a run scoped to part of the image redraws only the regions it touches and keeps the boxes of the reading it begins from elsewhere", async () => {
  const { principal, ref } = await setup("remote-partial");
  await cancelAnnotationRun(ref);
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Partial annotation test",
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
  const kept = {
    id: "kept",
    class: "seed",
    bbox: { x: 2, y: 2, width: 4, height: 4 },
  };
  const stale = {
    id: "stale",
    class: "seed",
    bbox: { x: 50, y: 50, width: 4, height: 4 },
  };
  await storeAnnotation(ref, [kept, stale], null);
  const userId = principal.kind === "user" ? principal.userId : "";
  const corner = { x: 48, y: 48, width: 16, height: 16 };
  await expect(
    createAnnotationRun(
      { ref, input: null, scope: [corner] },
      "interactive",
      userId,
    ),
  ).rejects.toThrow("needs the boxes to keep");
  await expect(
    createAnnotationRun(
      { ref, input: "proposal", scope: [corner] },
      "interactive",
      userId,
    ),
  ).rejects.toThrow("no proposal to begin from");
  await expect(
    createAnnotationRun(
      {
        ref,
        input: "review",
        scope: [{ ...corner, width: 32 }],
      },
      "interactive",
      userId,
    ),
  ).rejects.toThrow("exceeds image bounds");
  const partial = await createAnnotationRun(
    { ref, input: "review", scope: [corner] },
    "interactive",
    userId,
  );
  expect(partial.progress.total).toBe(1);
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(stored!.definition.input).toEqual([kept, stale]);
  const next = await nextAnnotationTask(principal, ref);
  expect(next.taskId).toBe(`${partial.id}/tile-003-003`);
  const preview = await savePreview(principal, next.taskId, {
    instances: [{ id: "fresh", class: "seed", box_2d: [500, 500, 700, 700] }],
  });
  const receipt = await submitProposal(
    principal,
    next.taskId,
    preview.proposalId,
  );
  expect(receipt.status).toBe("succeeded");
  const [done] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(
    done!.result!.document.instances.map((instance) => instance.id).sort(),
  ).toEqual([`${partial.id}/tile-003-003/fresh`, "kept"]);
  expect((await readAnnotation(ref))!.instances).toEqual([kept, stale]);
});

test("partial redraw preserves untouched proposal notes, replaces redrawn notes and exposes seam warnings", async () => {
  const { principal, ref } = await setup("remote-partial-notes");
  await cancelAnnotationRun(ref);
  const model = await createModel({
    id: crypto.randomUUID(),
    name: "Partial proposal notes",
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
  const userId = principal.kind === "user" ? principal.userId : "";
  const base = await createAnnotationRun(
    { ref, input: null, scope: null },
    "interactive",
    userId,
  );
  for (let i = 0; i < base.progress.total; i++) {
    const { taskId } = await nextAnnotationTask(principal, ref);
    const first = taskId.endsWith("tile-000-000");
    const neighbor = taskId.endsWith("tile-000-001");
    const corner = taskId.endsWith("tile-003-003");
    const box_2d = first
      ? [100, 600, 300, 950]
      : neighbor
        ? [100, 90, 300, 360]
        : [500, 500, 700, 700];
    const preview = await savePreview(principal, taskId, {
      instances:
        first || neighbor || corner
          ? [{ id: "seed", class: "seed", box_2d, uncertain: first || corner }]
          : [],
      issues:
        first || corner
          ? [
              {
                box_2d,
                reason: first ? "Check retained area" : "Check redrawn area",
              },
            ]
          : [],
    });
    await submitProposal(principal, taskId, preview.proposalId);
  }
  const before = (await readAnnotationReading(ref)).proposal!;
  expect(before.uncertainIds).toHaveLength(2);
  expect(before.issues).toHaveLength(2);
  expect(before.warnings).toHaveLength(1);

  const partial = await createAnnotationRun(
    {
      ref,
      input: "proposal",
      scope: [{ x: 48, y: 48, width: 16, height: 16 }],
    },
    "interactive",
    userId,
  );
  const db = await database();
  const [frozen] = await db
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, partial.id));
  expect(frozen!.definition.inputNotes).toEqual({
    issues: before.issues,
    uncertainIds: before.uncertainIds,
  });
  const { taskId } = await nextAnnotationTask(principal, ref);
  const preview = await savePreview(principal, taskId, { instances: [] });
  await submitProposal(principal, taskId, preview.proposalId);
  const after = (await readAnnotationReading(ref)).proposal!;
  expect(after.document.instances).toEqual(
    before.document.instances.filter(
      (item) => !item.id.includes("tile-003-003"),
    ),
  );
  expect(after.uncertainIds).toEqual(
    before.uncertainIds.filter((id) => !id.includes("tile-003-003")),
  );
  expect(after.issues).toEqual(
    before.issues.filter((issue) => issue.reason === "Check retained area"),
  );
  expect(after.warnings).toEqual(before.warnings);
  expect(await readAnnotation(ref)).toBeNull();

  const redraw = await createAnnotationRun(
    { ref, input: "proposal", scope: null },
    "interactive",
    userId,
  );
  for (let i = 0; i < redraw.progress.total; i++) {
    const next = await nextAnnotationTask(principal, ref);
    const empty = await savePreview(principal, next.taskId, { instances: [] });
    await submitProposal(principal, next.taskId, empty.proposalId);
  }
  const final = (await readAnnotationReading(ref)).proposal!;
  expect(final.document.instances).toEqual([]);
  expect(final.issues).toEqual([]);
  expect(final.uncertainIds).toEqual([]);
  expect(final.warnings).toEqual([]);
});
