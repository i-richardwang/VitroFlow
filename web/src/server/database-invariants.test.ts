import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { database } from "../db/client";
import {
  datasetSnapshotImages,
  experimentCultureEvents,
  modelVersions,
} from "../db/schema";
import { recordCultureEvent } from "./culture-events";
import {
  addObservationUnits,
  addTreatment,
  createExperiment,
} from "./experiment-design";
import { addObservation } from "./experiment-observations";
import { recordInferenceOutcome } from "./inference-outcomes";
import {
  baselineVersion,
  imageDigest,
  observeImages,
  registerTestModel,
  registerTrainedVersion,
  resultFor,
  testHeartbeat,
} from "./testing";

test("the database rejects a second active terminal event", async () => {
  const suffix = randomUUID();
  const version = await baselineVersion();
  const experiment = await createExperiment({
    name: `Terminal invariant ${suffix}`,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    modelVersionId: version.id,
  });
  const treatment = await addTreatment({
    experiment: experiment.id,
    name: "Control",
    factors: [],
    note: "",
    replicates: 0,
  });
  const [observationUnit] = await addObservationUnits({
    experiment: experiment.id,
    treatment: treatment.id,
    codes: ["A1"],
  });
  const day7 = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
  });
  const day14 = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-15",
    note: "",
  });
  await recordCultureEvent({
    experiment: experiment.id,
    observationUnit: observationUnit!.id,
    type: "discarded",
    observation: day7.id,
    excludeFromObservation: false,
    note: "Discarded after imaging",
  });

  let rejection: unknown;
  try {
    await (
      await database()
    )
      .insert(experimentCultureEvents)
      .values({
        experimentId: experiment.id,
        id: randomUUID(),
        observationUnitId: observationUnit!.id,
        observationId: day14.id,
        type: "missing",
        excludeFromObservation: true,
        note: "",
        recordedAt: new Date(),
        voidedAt: null,
        voidReason: "",
      })
      .execute();
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(Error);
  const cause = (rejection as Error & { cause?: unknown }).cause;
  expect((cause as Error & { code?: string }).code).toBe("23505");
  expect((cause as Error).message).toContain(
    "experiment_culture_events_one_active_terminal",
  );
});

test("the database rejects a trained version without its provenance", async () => {
  const suffix = randomUUID();
  const valid = await registerTrainedVersion(
    "seed-detector",
    `provenance-${suffix}`,
  );
  if (valid.source.kind !== "training_run") {
    throw new Error("expected a trained model version");
  }

  await expect(
    (await database())
      .insert(modelVersions)
      .values({
        id: `seed-detector.orphan-${suffix}`,
        modelId: valid.modelId,
        name: "Orphan provenance",
        createdAt: new Date(valid.createdAt),
        source: {
          ...valid.source,
          trainingRunId: `missing-${suffix}`,
        },
        artifact: valid.artifact,
      })
      .execute(),
  ).rejects.toThrow();
});

test("the database binds snapshot annotations to the snapshot model", async () => {
  const suffix = randomUUID();
  const modelId = `snapshot-other-${suffix}`;
  await registerTestModel({
    schemaVersion: 1,
    id: modelId,
    name: "Snapshot other model",
    task: "object_detection",
    classes: ["seed"],
    metrics: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
  });
  const other = await registerTrainedVersion(
    modelId,
    `snapshot-source-${suffix}`,
  );
  if (other.source.kind !== "training_run") {
    throw new Error("expected a trained model version");
  }
  const { version } = await observeImages("snapshot-invariant", [
    "snapshot-invariant-image",
  ]);
  const digest = await imageDigest("snapshot-invariant-image");
  const result = await resultFor(version, "snapshot-invariant-image");
  await recordInferenceOutcome({ versionId: version.id, digest }, result, {
    runtimes: testHeartbeat("snapshot-invariant-worker").runtimes,
  });

  await expect(
    (await database())
      .insert(datasetSnapshotImages)
      .values({
        snapshotId: other.source.datasetSnapshotId,
        modelId: other.modelId,
        imageId: digest,
        split: "train",
        annotation: {
          ...documentFromDetection(result),
          status: "complete",
        },
      })
      .execute(),
  ).rejects.toThrow();
});
