import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { recordInferenceHeartbeat } from "./inference-worker-store";
import {
  startAnnotationFromDetection,
  readAnnotation,
  updateAnnotation,
} from "./annotations";
import { recordInferenceOutcome } from "./inference-outcomes";
import { datasetOverview } from "./dataset-overview";
import { trainingOverview } from "./training-console";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
} from "./training-runs";
import { recordTrainingHeartbeat } from "./training-worker-store";
import { testHeartbeat, imageDigest, resultFor, uploadTexts } from "./testing";

/** This test's clock; workers heartbeating at wall-clock time are offline here. */
const HEARTBEAT_AT = new Date(Date.now() + 24 * 60 * 60 * 1000);
const OVERVIEW_AT = new Date(HEARTBEAT_AT.getTime() + 10_000);

test("the overview derives review progress and training readiness", async () => {
  const at = OVERVIEW_AT;
  const { version } = await uploadTexts("overview", ["ov-a", "ov-b", "ov-c"]);
  const worker = await recordInferenceHeartbeat(
    testHeartbeat("overview-worker"),
    HEARTBEAT_AT,
  );
  for (const name of ["ov-a", "ov-b"]) {
    const digest = await imageDigest(name);
    await recordInferenceOutcome(
      { versionId: version.id, digest },
      await resultFor(version, name),
      worker,
    );
    const ref = { digest, modelId: version.modelId };
    const started = await startAnnotationFromDetection(ref, version.id);
    await updateAnnotation(ref, { ...started, status: "complete" });
  }

  let overview = await datasetOverview("overview", at);
  if (!overview) throw new Error("missing overview");
  expect(overview.model.id).toBe(version.modelId);
  expect(overview.counts).toMatchObject({ unreviewed: 1, complete: 2 });
  expect(overview.images.map((image) => image.detectionCount)).toEqual([
    0,
    0,
    null,
  ]);
  expect(overview.training).toEqual({
    runs: 0,
    active: null,
    reviewedSinceLastRun: 2,
    workersOnline: 0,
    workerMemoryBytes: null,
  });

  const run = await createTrainingRun("overview", YOLO26_SEED_SMALL_RECIPE);
  overview = await datasetOverview("overview", at);
  expect(overview?.training.active?.id).toBe(run.id);
  expect(overview?.training.reviewedSinceLastRun).toBe(0);
  await recordTrainingHeartbeat(
    {
      workerId: "overview-trainer",
      sessionId: "overview-trainer-session",
      startedAt: HEARTBEAT_AT.toISOString(),
      device: "cpu",
      memoryBytes: 24 * 1024 ** 3,
      currentTrainingRunId: null,
    },
    HEARTBEAT_AT,
  );
  const owner = {
    workerId: "overview-trainer",
    sessionId: "overview-trainer-session",
  };
  expect((await claimTrainingRun(owner))?.id).toBe(run.id);
  await failTrainingRun(run.id, owner, "stopped");
  overview = await datasetOverview("overview", at);
  expect(overview?.training.active).toBeNull();
  expect(overview?.training.workersOnline).toBe(1);

  const a = { digest: await imageDigest("ov-a"), modelId: version.modelId };
  const annotation = await readAnnotation(a);
  if (!annotation) throw new Error("missing annotation");
  await updateAnnotation(a, annotation);
  expect(
    (await datasetOverview("overview", at))?.training.reviewedSinceLastRun,
  ).toBe(1);

  const training = await trainingOverview(at);
  expect(training.versions.map(({ version }) => version.id)).toContain(
    version.id,
  );
  expect(training.runs.map((summary) => summary.run.id)).toContain(run.id);
  expect(
    training.runs.find((summary) => summary.run.id === run.id)?.dataset,
  ).toBe("overview");
});

test("the overview is absent for unknown datasets", async () => {
  expect(await datasetOverview("nowhere")).toBeNull();
});
