import { expect, test } from "bun:test";

import { documentFromPrelabel } from "../annotation/prelabel";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { selectModelVersion } from "./datasets";
import { recordInferenceHeartbeat } from "./inference-worker-store";
import { createLabel, readLabel, updateLabel } from "./labels";
import { registerModelVersion } from "./model-registry";
import { datasetOverview } from "./overview";
import { writePrelabel } from "./prelabels";
import {
  claimTrainingRun,
  createTrainingRun,
  failTrainingRun,
} from "./training-runs";
import { recordTrainingHeartbeat } from "./training-worker-store";
import {
  TEST_RUNTIME as runtime,
  imageDigest,
  resultFor,
  uploadTexts,
} from "./testing";

/** This test's clock; workers heartbeating at wall-clock time are offline here. */
const HEARTBEAT_AT = new Date(Date.now() + 24 * 60 * 60 * 1000);
const OVERVIEW_AT = new Date(HEARTBEAT_AT.getTime() + 10_000);
const LATER_AT = new Date(HEARTBEAT_AT.getTime() + 60 * 60 * 1000);

async function datasetWithImages(datasetId: string, names: string[]) {
  const { dataset, version } = await uploadTexts(datasetId, names);
  const worker = await recordInferenceHeartbeat(
    {
      workerId: `${datasetId}-worker`,
      startedAt: "2026-08-27T00:00:00.000Z",
      deployment: {
        modelVersionId: version.id,
        artifactDigest: version.artifact.digest,
      },
      runtime,
      current: null,
    },
    HEARTBEAT_AT,
  );
  const prelabelFor = (name: string) => resultFor(version, name);
  return { dataset, version, worker, prelabelFor };
}

test("the overview derives versions, serving workers, and training readiness", async () => {
  const at = OVERVIEW_AT;
  const { version, worker, prelabelFor } = await datasetWithImages("overview", [
    "a",
    "b",
    "c",
  ]);
  for (const name of ["a", "b"]) {
    const ref = { dataset: "overview", digest: imageDigest(name) };
    await writePrelabel(ref, prelabelFor(name), worker);
    await createLabel(ref, {
      ...documentFromPrelabel(prelabelFor(name)),
      status: "complete",
    });
  }

  let overview = await datasetOverview("overview", at);
  if (!overview) throw new Error("missing overview");
  expect(overview.counts).toMatchObject({ pending: 1, complete: 2 });
  expect(overview.images.map((image) => image.modelVersionId)).toEqual([
    version.id,
    version.id,
    null,
  ]);
  expect(overview.versions).toEqual([
    {
      version,
      selected: true,
      serving: { online: 1, stale: 0 },
      trainingImages: null,
    },
  ]);
  expect(overview.training).toMatchObject({
    runs: [],
    active: null,
    reviewedSinceLastRun: 2,
    workersOnline: 0,
    recipe: YOLO26_SEED_SMALL_RECIPE,
  });

  const run = await createTrainingRun("overview", YOLO26_SEED_SMALL_RECIPE);
  overview = await datasetOverview("overview", at);
  expect(overview?.training.active?.id).toBe(run.id);
  expect(overview?.training.reviewedSinceLastRun).toBe(0);
  await recordTrainingHeartbeat(
    {
      workerId: "overview-trainer",
      startedAt: HEARTBEAT_AT.toISOString(),
      device: "cpu",
      currentTrainingRunId: null,
    },
    HEARTBEAT_AT,
  );
  expect((await claimTrainingRun("overview-trainer"))?.id).toBe(run.id);
  await failTrainingRun(run.id, "overview-trainer", "stopped");
  overview = await datasetOverview("overview", at);
  expect(overview?.training.active).toBeNull();
  expect(overview?.training.workersOnline).toBe(1);

  const a = { dataset: "overview", digest: imageDigest("a") };
  const label = await readLabel(a);
  if (!label) throw new Error("missing label");
  await updateLabel(a, label);
  expect(
    (await datasetOverview("overview", at))?.training.reviewedSinceLastRun,
  ).toBe(1);

  const next = await registerModelVersion({
    schemaVersion: 1,
    id: "overview.traditional-v2",
    modelId: "overview",
    name: "Traditional vision v2",
    createdAt: LATER_AT.toISOString(),
    source: { kind: "builtin", definition: "traditional-v2" },
    artifact: { kind: "traditional", digest: "c".repeat(64) },
  });
  await selectModelVersion("overview", next.id);
  overview = await datasetOverview("overview", at);
  expect(
    overview?.versions.map(({ version, selected, serving }) => [
      version.id,
      selected,
      serving,
    ]),
  ).toEqual([
    [next.id, true, { online: 0, stale: 0 }],
    [version.id, false, { online: 1, stale: 0 }],
  ]);
  const staleAt = new Date(HEARTBEAT_AT.getTime() + 60_000);
  expect(
    (await datasetOverview("overview", staleAt))?.versions[1]?.serving,
  ).toEqual({
    online: 0,
    stale: 1,
  });
  expect(
    (await datasetOverview("overview", LATER_AT))?.versions[1]?.serving,
  ).toEqual({
    online: 0,
    stale: 0,
  });
});

test("the overview is absent for unknown datasets", async () => {
  expect(await datasetOverview("nowhere")).toBeNull();
});
