import { expect, test } from "bun:test";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { YOLO26_SEED_SMALL_RECIPE } from "../../domain/training/recipes";
import { readAnnotation, storeAnnotation } from "../annotations/documents";
import { seedInferenceOutcome } from "../testing/inference";
import { datasetOverview } from "./dataset-overview";
import { modelOverview } from "./model-overview";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
} from "../training/runs";
import {
  imageDigest,
  recordTestHeartbeat,
  resultFor,
  testHeartbeat,
  ULTRALYTICS_RUNTIME,
  uploadTexts,
} from "../testing/fixtures";

/** This test's clock; workers heartbeating at wall-clock time are offline here. */
const HEARTBEAT_AT = new Date(Date.now() + 24 * 60 * 60 * 1000);
const OVERVIEW_AT = new Date(HEARTBEAT_AT.getTime() + 10_000);

test("the overview derives review progress and training readiness", async () => {
  const at = OVERVIEW_AT;
  const { version } = await uploadTexts("overview", ["ov-a", "ov-b", "ov-c"]);
  const worker = await recordTestHeartbeat(
    testHeartbeat("overview-worker"),
    HEARTBEAT_AT,
  );
  for (const name of ["ov-a", "ov-b"]) {
    const digest = await imageDigest(name);
    const result = await resultFor(version, name);
    await seedInferenceOutcome(
      { versionId: version.id, digest },
      result,
      worker,
    );
    await storeAnnotation(
      { digest, modelId: version.modelId },
      instancesFromDetection(result),
      null,
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
  const owner = await recordTestHeartbeat(
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
  await storeAnnotation(a, annotation.instances, annotation.instances);
  expect(
    (await datasetOverview("overview", at))?.training.reviewedSinceLastRun,
  ).toBe(0);
  await storeAnnotation(
    a,
    [
      {
        id: "added",
        class: "ungerminated",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
    annotation.instances,
  );
  expect(
    (await datasetOverview("overview", at))?.training.reviewedSinceLastRun,
  ).toBe(1);

  expect(
    (await datasetOverview("overview", at))?.runs.map(({ run }) => run.id),
  ).toEqual([run.id]);

  const model = await modelOverview(version.modelId);
  expect(model?.versions.map((item) => item.version.id)).toContain(version.id);
  expect(model?.datasets.map((item) => item.dataset)).toContain("overview");
  expect(
    model?.runs.find((summary) => summary.run.id === run.id)?.dataset,
  ).toBe("overview");
});

test("the overview is absent for unknown datasets and models", async () => {
  expect(await datasetOverview("nowhere")).toBeNull();
  expect(await modelOverview("nowhere")).toBeNull();
});
