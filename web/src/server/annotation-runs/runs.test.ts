import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import type {
  AnnotationRunResult,
  StartAnnotationRun,
} from "../../domain/annotation-runs/schema";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import { readReview } from "../annotations/review";
import { createModel, setModelAnnotation } from "../models/public";
import { annotationRuns } from "../infra/db/schema";
import { database } from "../infra/db/client";
import { observeImages, signInAs, testHeartbeat } from "../testing/fixtures";
import { recordWorkerHeartbeat } from "../workers/sessions";
import {
  createAnnotationRun,
  claimAnnotationRun,
  renewAnnotationRun,
  progressAnnotationRun,
  completeAnnotationRun,
  cancelAnnotationRun,
  createAnnotationRuns,
} from "./runs";

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
    runtime: "pi" as const,
    input: null,
  } satisfies StartAnnotationRun;
  return { user, owner, request, runtime, digests: observed.digests };
}
const instance = {
  id: "seed-a",
  class: "seed",
  bbox: { x: 2, y: 3, width: 10, height: 11 },
};

test("the model's instructions and region are frozen into the assignment", async () => {
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
  const assignment = (await claimAnnotationRun(owner))!;
  expect(assignment.config).toEqual({
    classes: ["seed"],
    rules: annotation.instructions,
    coreSize: 16,
    halo: 8,
    displayScale: 4,
  });
  expect(run.progress.total).toBe(
    Math.ceil(assignment.image.width / 16) *
      Math.ceil(assignment.image.height / 16),
  );
  await cancelAnnotationRun(run.id);
});
function resultFor(
  image: { digest: string; width: number; height: number },
  runtime: { runtime: "pi" | "antigravity"; version: string; model: string },
): AnnotationRunResult {
  return {
    document: { schemaVersion: 1, image, instances: [instance] },
    packageId: "a".repeat(64),
    checkpointDigests: { "tile-000-000": "b".repeat(64) },
    issues: [],
    warnings: [],
    uncertainIds: [],
    execution: {
      ...runtime,
      elapsedSeconds: 1,
    },
  };
}

test("a frozen AI run completes independently of accepted annotations, is explicitly saved as a normal review", async () => {
  const { user, owner, request, runtime } = await setup("ai-product");
  const run = await createAnnotationRun(request, user.id);
  expect(run.status).toBe("queued");
  expect(await createAnnotationRun(request, user.id)).toEqual(run);
  await expect(
    createAnnotationRun({ ...request, input: [] }, user.id),
  ).rejects.toThrow("different inputs");
  await expect(
    createAnnotationRun({ ...request, id: "ai-other" }, user.id),
  ).rejects.toThrow("active AI annotation");
  const assignment = await claimAnnotationRun(owner);
  expect(assignment?.input).toBeNull();
  expect(await claimAnnotationRun(owner)).toEqual(assignment);
  const result = resultFor(assignment!.image, runtime);
  await progressAnnotationRun(run.id, owner, 1, 1);
  await completeAnnotationRun(run.id, owner, result);
  await completeAnnotationRun(run.id, owner, result);
  expect(await readAnnotation(request.ref)).toBeNull();
  const db = await database();
  const review = (await readReview(request.ref, "ai-product.jpg", db))!;
  expect(review.proposal?.document).toEqual(result.document);
  expect(review.proposal?.agent).toBe("pi");
  expect(review.activity).toBeNull();
  expect(review.annotation).toBeNull();
  await storeAnnotation(request.ref, result.document.instances, null);
  expect((await readAnnotation(request.ref))?.instances).toEqual([instance]);
  const next = await createAnnotationRun(
    { ...request, id: "ai-product-again", input: [instance] },
    user.id,
  );
  expect(next.status).toBe("queued");
  expect((await claimAnnotationRun(owner))?.input).toEqual([instance]);
  await cancelAnnotationRun(next.id);
});

test("cancelled and expired runs cannot publish; a replacement session fences the old process", async () => {
  const { user, owner, request, runtime } = await setup("ai-fencing");
  await createAnnotationRun(request, user.id);
  const assignment = (await claimAnnotationRun(owner))!;
  await cancelAnnotationRun(request.id);
  await expect(
    completeAnnotationRun(
      request.id,
      owner,
      resultFor(assignment.image, runtime),
    ),
  ).rejects.toThrow("no longer active");
  const second = { ...request, id: "ai-fencing-second" };
  await createAnnotationRun(second, user.id);
  const at = new Date();
  await claimAnnotationRun(owner, at);
  await expect(
    renewAnnotationRun(second.id, owner, new Date(at.getTime() + 301000)),
  ).rejects.toThrow("no longer active");
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    sessionId: "new-session",
    startedAt: new Date().toISOString(),
    annotationRuntimes: [runtime],
  });
  await expect(renewAnnotationRun(second.id, owner)).rejects.toThrow(
    "no longer active",
  );
  await cancelAnnotationRun(second.id);
});

test("wrong images, labels, geometry and incomplete evidence are rejected without changing the draft", async () => {
  const { user, owner, request, runtime } = await setup("ai-validation");
  await createAnnotationRun(request, user.id);
  const assignment = (await claimAnnotationRun(owner))!;
  const result = resultFor(assignment.image, runtime);
  await expect(
    completeAnnotationRun(request.id, owner, {
      ...result,
      document: {
        ...result.document,
        image: { ...assignment.image, digest: "c".repeat(64) },
      },
    }),
  ).rejects.toThrow("different image");
  await expect(
    completeAnnotationRun(request.id, owner, {
      ...result,
      checkpointDigests: {},
    }),
  ).rejects.toThrow("Incomplete");
  await expect(
    completeAnnotationRun(request.id, owner, {
      ...result,
      document: {
        ...result.document,
        instances: [{ ...instance, class: "weed" }],
      },
    }),
  ).rejects.toThrow("unknown class");
  await expect(
    completeAnnotationRun(request.id, owner, {
      ...result,
      document: {
        ...result.document,
        instances: [{ ...instance, bbox: { ...instance.bbox, x: 1000 } }],
      },
    }),
  ).rejects.toThrow("image bounds");
  await storeAnnotation(request.ref, [], null);
  await completeAnnotationRun(request.id, owner, result);
  expect((await readAnnotation(request.ref))?.instances).toEqual([]);
  await expect(storeAnnotation(request.ref, [instance], null)).rejects.toThrow(
    "changed",
  );
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
    createAnnotationRun({ ...request, runtime: "antigravity" }, user.id),
  ).rejects.toThrow("No online Worker provides");
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime, antigravity],
  });
  const run = await createAnnotationRun(
    { ...request, runtime: "antigravity" },
    user.id,
  );
  expect(run.runtime).toBe("antigravity");
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
  const assignment = (await claimAnnotationRun(other))!;
  expect(assignment.runtime).toBe("antigravity");
  await expect(
    completeAnnotationRun(run.id, other, resultFor(assignment.image, runtime)),
  ).rejects.toThrow("different agent");
  await completeAnnotationRun(run.id, other, {
    ...resultFor(assignment.image, runtime),
    execution: { ...antigravity, version: "1.3.0", elapsedSeconds: 1 },
  });
  const [stored] = await (
    await database()
  )
    .select()
    .from(annotationRuns)
    .where(eq(annotationRuns.id, run.id));
  expect(stored?.status).toBe("succeeded");
  expect(stored?.result?.execution.version).toBe("1.3.0");
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
