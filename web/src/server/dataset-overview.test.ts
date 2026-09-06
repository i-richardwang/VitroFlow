import { expect, test } from "bun:test";

import { instancesFromDetection } from "../annotation/detection";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { readAnnotation, storeAnnotation } from "./annotations";
import { recordInferenceOutcome } from "./inference-outcomes";
import { datasetOverview } from "./dataset-overview";
import { trainingOverview } from "./training-console";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
} from "./training-runs";
import {
  ULTRALYTICS_RUNTIME,
  imageDigest,
  resultFor,
  testHeartbeat,
  uploadTexts,
} from "./testing";
import { recordWorkerHeartbeat } from "./workers";

/** This test's clock; workers heartbeating at wall-clock time are offline here. */
const HEARTBEAT_AT = new Date(Date.now() + 24 * 60 * 60 * 1000);
const OVERVIEW_AT = new Date(HEARTBEAT_AT.getTime() + 10_000);

test("the overview derives review progress and training readiness", async () => {
  const at = OVERVIEW_AT;
  const { version } = await uploadTexts("overview", ["ov-a", "ov-b", "ov-c"]);
  const worker = await recordWorkerHeartbeat(
    testHeartbeat("overview-worker"),
    HEARTBEAT_AT,
  );
  for (const name of ["ov-a", "ov-b"]) {
    const digest = await imageDigest(name);
    const result = await resultFor(version, name);
    await recordInferenceOutcome(
      { versionId: version.id, digest },
      result,
      worker,
    );
    await storeAnnotation(
      { digest, modelId: version.modelId },
      instancesFromDetection(result),
    );
  }

  let overview = await datasetOverview("overview", at);
  if (!overview) throw new Error("missing overview");
  expect(overview.model.id).toBe(version.modelId);
  expect(overview.reviewedCount).toBe(2);
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
  const owner = await recordWorkerHeartbeat(
    {
      ...testHeartbeat("overview-trainer"),
      runtimes: [ULTRALYTICS_RUNTIME],
      memoryBytes: 24 * 1024 ** 3,
    },
    HEARTBEAT_AT,
  );
  expect((await claimTrainingRun(owner))?.id).toBe(run.id);
  await failTrainingRun(run.id, owner, "stopped");
  overview = await datasetOverview("overview", at);
  expect(overview?.training.active).toBeNull();
  expect(overview?.training.workersOnline).toBe(1);

  const a = { digest: await imageDigest("ov-a"), modelId: version.modelId };
  const annotation = await readAnnotation(a);
  if (!annotation) throw new Error("missing annotation");
  await storeAnnotation(a, annotation.instances);
  expect(
    (await datasetOverview("overview", at))?.training.reviewedSinceLastRun,
  ).toBe(0);
  await storeAnnotation(a, [
    {
      id: "added",
      class: "seed",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
    },
  ]);
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
