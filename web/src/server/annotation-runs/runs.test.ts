import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  SEED_ANNOTATION_RULES,
  DEFAULT_ANNOTATION_REGION,
  startAnnotationRunSchema,
  type AnnotationRunResult,
} from "../../domain/annotation-runs/schema";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
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
  listAnnotationRuns,
} from "./runs";

async function setup(name: string) {
  const { user } = await signInAs("member");
  const observed = await observeImages(name, [name]);
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
    workerId: name,
    runtime,
    input: null,
    base: null,
    rules: SEED_ANNOTATION_RULES,
    region: DEFAULT_ANNOTATION_REGION,
  };
  return { user, owner, request, runtime };
}
const instance = {
  id: "seed-a",
  class: "seed",
  bbox: { x: 2, y: 3, width: 10, height: 11 },
};

test("region settings are validated, frozen and included in request identity", async () => {
  const { user, owner, request } = await setup("ai-region");
  const region = { coreSize: 16, halo: 8, displayScale: 4 };
  const custom = startAnnotationRunSchema.parse({ ...request, region });
  for (const invalid of [
    { ...region, coreSize: 0 },
    { ...region, halo: 17 },
    { ...region, displayScale: 5 },
  ]) {
    expect(
      startAnnotationRunSchema.safeParse({ ...request, region: invalid })
        .success,
    ).toBe(false);
  }
  const run = await createAnnotationRun(custom, user.id);
  expect(run.region).toEqual(region);
  const assignment = (await claimAnnotationRun(owner))!;
  expect(assignment.config).toEqual({
    ...region,
    classes: ["seed"],
    rules: request.rules,
  });
  expect(run.progress.total).toBe(
    Math.ceil(assignment.image.width / region.coreSize) *
      Math.ceil(assignment.image.height / region.coreSize),
  );
  await expect(
    createAnnotationRun(
      { ...custom, region: DEFAULT_ANNOTATION_REGION },
      user.id,
    ),
  ).rejects.toThrow("different inputs");
  expect((await listAnnotationRuns(request.ref))[0]?.region).toEqual(region);
});
function resultFor(
  image: { digest: string; width: number; height: number },
  runtime: { runtime: "pi"; version: string; model: string },
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
    createAnnotationRun({ ...request, rules: "changed" }, user.id),
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
  expect((await listAnnotationRuns(request.ref))[0]?.result).toEqual(result);
  await storeAnnotation(request.ref, result.document.instances, null);
  expect((await readAnnotation(request.ref))?.instances).toEqual([instance]);
  const next = await createAnnotationRun(
    { ...request, id: "ai-product-again", base: [instance], input: [instance] },
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
  await expect(
    createAnnotationRun({ ...request, id: "stale-base-run" }, user.id),
  ).rejects.toThrow("changed");
});

test("listing projects an expired lease without writing and a new request retires it", async () => {
  const { user, owner, request } = await setup("ai-read-only");
  await createAnnotationRun(request, user.id);
  await claimAnnotationRun(owner, new Date(Date.now() - 301000));
  const db = await database();
  const stored = () =>
    db.select().from(annotationRuns).where(eq(annotationRuns.id, request.id));
  const [before] = await stored();
  const [visible] = await listAnnotationRuns(request.ref);
  expect(visible?.status).toBe("failed");
  expect(visible?.error).toContain("lease expired");
  expect(await stored()).toEqual([before!]);
  await createAnnotationRun({ ...request, id: "ai-read-only-next" }, user.id);
  expect((await stored())[0]?.status).toBe("failed");
  await cancelAnnotationRun("ai-read-only-next");
});

test("one Worker advertises both runtimes and a run pins the selected descriptor", async () => {
  const { user, owner, request, runtime } = await setup("ai-choice");
  const antigravity = {
    runtime: "antigravity" as const,
    version: "1.2.3",
    model: "default-vision",
  };
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime, antigravity],
  });
  await expect(
    createAnnotationRun(
      { ...request, runtime: { ...antigravity, version: "stale" } },
      user.id,
    ),
  ).rejects.toThrow("not available");
  const run = await createAnnotationRun(
    { ...request, runtime: antigravity },
    user.id,
  );
  expect(run.runtime).toEqual(antigravity);
  await expect(createAnnotationRun(request, user.id)).rejects.toThrow(
    "different inputs",
  );
  // A queued run cannot silently use a different runtime or model after a heartbeat.
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime],
  });
  expect(await claimAnnotationRun(owner)).toBeNull();
  await recordWorkerHeartbeat({
    ...testHeartbeat(owner.workerId),
    annotationRuntimes: [runtime, antigravity],
  });
  const assignment = (await claimAnnotationRun(owner))!;
  expect(assignment.runtime).toEqual(antigravity);
  await expect(
    completeAnnotationRun(run.id, owner, resultFor(assignment.image, runtime)),
  ).rejects.toThrow("runtime differs");
  await completeAnnotationRun(run.id, owner, {
    ...resultFor(assignment.image, runtime),
    execution: { ...antigravity, elapsedSeconds: 1 },
  });
  expect((await listAnnotationRuns(request.ref))[0]!.status).toBe("succeeded");
});
