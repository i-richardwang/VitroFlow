import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { database } from "../db/client";
import { experimentCultureEvents, modelVersions } from "../db/schema";
import { recordCultureEvent } from "./culture-events";
import {
  addObservationUnits,
  addTreatment,
  createExperiment,
} from "./experiment-design";
import { addObservation } from "./experiment-observations";
import { baselineVersion, registerTrainedVersion } from "./testing";

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
    factor: null,
    note: "",
    replicates: 1,
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
