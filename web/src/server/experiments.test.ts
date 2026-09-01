import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { database } from "../db/client";
import {
  experimentCultureEvents,
  experimentObservationUnits,
  experimentObservations,
  experiments,
  inferenceOutcomes,
} from "../db/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import type { ModelVersion } from "../models/schema";
import {
  ObservationUnitNotFoundError,
  ObservationUnitRejectedError,
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  ExperimentObservationImageAlreadyUsedError,
  ObservationImageRejectedError,
  ObservationRejectedError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
} from "../experiments/errors";
import {
  experimentRequestSchema,
  calendarDaySchema,
  formatFactor,
  treatmentRequestSchema,
  type ExperimentRequestInput,
} from "../experiments/schema";
import { blobExists, imageBlobKey } from "./blobs";
import { collectImages } from "./image-collection";
import {
  pendingAssignments,
  recordInferenceOutcome,
} from "./inference-outcomes";
import {
  addObservationUnits,
  addTreatment,
  assignObservationUnits,
  createExperiment as createExperimentRecord,
  deleteObservationUnit,
  deleteExperiment,
  deleteTreatment,
  readExperiment,
  updateObservationUnit,
  updateTreatment,
  updateExperiment,
} from "./experiment-design";
import { recordCultureEvent, voidCultureEvent } from "./culture-events";
import {
  assignObservationImages,
  moveObservationImage,
  retryObservationImageAnalysis,
  unassignObservationImage,
} from "./experiment-observation-images";
import {
  addObservation,
  deleteObservation,
  updateObservation,
} from "./experiment-observations";
import {
  listExperiments,
  readObservationUnit,
  readExperimentGrid,
  readExperimentObservationImage,
} from "./experiment-queries";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { listAllModelVersions } from "./model-registry";
import {
  FIXTURE_EDGE,
  ULTRALYTICS_RUNTIME,
  baselineVersion,
  imageDigest,
  registerTestModel,
  registerTrainedVersion,
  storeTexts,
  testHeartbeat,
} from "./testing";

const INOCULATED = "2026-08-01";

function createExperiment(value: ExperimentRequestInput) {
  return createExperimentRecord(experimentRequestSchema.parse(value));
}

const worker: InferenceWorkerRecord = {
  ...testHeartbeat("ultralytics-worker"),
  runtimes: [ULTRALYTICS_RUNTIME],
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function trainedVersion(modelId: string): Promise<ModelVersion> {
  await registerTestModel({
    schemaVersion: 1,
    id: modelId,
    name: `${modelId} detector`,
    task: "object_detection",
    classes: ["seed"],
    metrics: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
  });
  return registerTrainedVersion(modelId);
}

function resultFor(version: ModelVersion, digest: string, seeds: number) {
  return {
    ...makeResult(
      Array.from({ length: seeds }, (_, id) => ({
        id,
        x: 12 + id * 14,
        y: 12,
      })),
      { digest, dishRadius: 400, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    ),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
  };
}

function failureFor(version: ModelVersion, digest: string) {
  return {
    schemaVersion: 1 as const,
    image: { digest },
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
    error: "no observation unit found",
  };
}

async function defineObservationUnits(
  experiment: string,
  codes: string[],
): Promise<Map<string, string>> {
  const treatment = await addTreatment({
    experiment,
    name: "Test",
    factor: null,
    note: "",
    replicates: 0,
  });
  const observationUnits = await addObservationUnits({
    experiment,
    treatment: treatment.id,
    codes,
  });
  return new Map(
    observationUnits.map((observationUnit) => [
      observationUnit.code,
      observationUnit.id,
    ]),
  );
}

async function assignImages(
  experiment: string,
  observation: string,
  observationUnits: Map<string, string>,
  contents: Record<string, string>,
) {
  const entries = Object.entries(contents);
  const digests = await storeTexts(entries.map(([, content]) => content));
  return assignObservationImages({
    experiment,
    observation,
    images: entries.map(([code], index) => ({
      observationUnit: observationUnits.get(code)!,
      digest: digests[index]!,
      filename: `${code}.jpg`,
    })),
  });
}

async function imagesByObservationUnit(
  experiment: string,
): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
  const codes = new Map(
    grid!.observationUnits.map((observationUnit) => [
      observationUnit.id,
      observationUnit.code,
    ]),
  );
  return new Map(
    grid!.images.map((image) => [codes.get(image.observationUnit)!, image.id]),
  );
}

describe("experiments", () => {
  test("start on a fresh deployment with the builtin seed detector", async () => {
    expect(calendarDaySchema.safeParse("2026-02-29").success).toBeFalse();
    expect(calendarDaySchema.safeParse("2024-02-29").success).toBeTrue();
    const offered = await listAllModelVersions();
    expect(offered.map((version) => version.id)).toContain(
      SEED_DETECTOR_BASELINE_VERSION_ID,
    );
    const experiment = await createExperiment({
      name: "Day one",
      inoculatedOn: INOCULATED,
      modelVersionId: SEED_DETECTOR_BASELINE_VERSION_ID,
    });
    expect(experiment.modelVersionId).toBe(SEED_DETECTOR_BASELINE_VERSION_ID);
    expect(experiment.inoculatedOn).toBe(INOCULATED);
  });

  test("have server-owned identities, user-facing names, and one fixed version", async () => {
    const version = await trainedVersion("exp-kind");
    const first = await createExperiment({
      name: "  Germination A  ",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const second = await createExperiment({
      name: "Germination A",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.name).toBe("Germination A");
    expect(first.modelVersionId).toBe(version.id);

    const traditional = await baselineVersion();
    const baseline = await createExperiment({
      name: "Baseline",
      inoculatedOn: INOCULATED,
      modelVersionId: traditional.id,
    });
    expect(baseline.modelVersionId).toBe(traditional.id);

    const unknownVersion = (async () => {
      await (await database()).insert(experiments).values({
        id: randomUUID(),
        name: "Bypass",
        plantMaterial: "",
        explantType: "",
        baseMedium: "",
        notes: "",
        inoculatedOn: INOCULATED,
        modelVersionId: "nobody.v9",
        createdAt: new Date(),
      });
    })();
    await expect(unknownVersion).rejects.toThrow();

    const invalidObservationUnit = (async () => {
      await (await database()).insert(experimentObservationUnits).values({
        experimentId: first.id,
        id: randomUUID(),
        code: " A1 ",
      });
    })();
    await expect(invalidObservationUnit).rejects.toThrow();
  });

  test("the design defines observation units before any image exists", async () => {
    const version = await trainedVersion("exp-design");
    const experiment = await createExperiment({
      name: "Hormones",
      plantMaterial: "  Arabidopsis Col-0  ",
      explantType: "Seeds",
      baseMedium: "MS",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    expect(experiment.plantMaterial).toBe("Arabidopsis Col-0");
    expect([experiment.explantType, experiment.baseMedium]).toEqual([
      "Seeds",
      "MS",
    ]);
    expect(experiment.notes).toBe("");

    const control = await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factor: null,
      note: "Hormone-free MS",
      replicates: 2,
    });
    const auxin = await addTreatment(
      treatmentRequestSchema.parse({
        experiment: experiment.id,
        name: " T1 ",
        factor: { name: " 6-BA ", level: "1.0", unit: " mg/L " },
        replicates: 3,
      }),
    );
    expect([control.position, auxin.position]).toEqual([1, 2]);
    expect(auxin.name).toBe("T1");
    expect(auxin.factor).toEqual({
      name: "6-BA",
      level: "1.0",
      unit: "mg/L",
    });

    const empty = await readExperimentGrid(experiment.id);
    expect(empty?.observations).toEqual([]);
    expect(
      empty?.observationUnits.map((observationUnit) => [
        observationUnit.code,
        observationUnit.position,
      ]),
    ).toEqual([
      ["CK-1", 1],
      ["CK-2", 2],
      ["T1-1", 3],
      ["T1-2", 4],
      ["T1-3", 5],
    ]);
    expect(
      empty?.observationUnits.every(
        (observationUnit) => observationUnit.events.length === 0,
      ),
    ).toBeTrue();

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.treatmentNames).toEqual(["CK", "T1"]);
    expect(summary?.latestDay).toBeNull();
  });

  test("an observation can be scheduled before the design is complete", async () => {
    const version = await trainedVersion("exp-planned-observation");
    const experiment = await createExperiment({
      name: "Planned observation",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factor: null,
      note: "",
      replicates: 0,
    });
    expect(
      (await readExperimentGrid(experiment.id))?.observationUnits,
    ).toEqual([]);

    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
      }),
    ).resolves.toMatchObject({ day: 7 });

    await addObservationUnits({
      experiment: experiment.id,
      treatment: null,
      codes: ["A1"],
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-15",
        note: "",
      }),
    ).resolves.toMatchObject({ day: 14 });

    await deleteExperiment({ experiment: experiment.id });
    expect(await readExperiment(experiment.id)).toBeNull();
  });

  test("a treatment can gain observation units after it is created", async () => {
    const version = await trainedVersion("exp-more-units");
    const experiment = await createExperiment({
      name: "More units",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const treatment = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factor: null,
      note: "",
      replicates: 1,
    });
    await addObservationUnits({
      experiment: experiment.id,
      treatment: treatment.id,
      codes: ["T1-2", "T1-3"],
    });
    const grid = await readExperimentGrid(experiment.id);
    expect(
      grid?.observationUnits.map((observationUnit) => observationUnit.code),
    ).toEqual(["T1-1", "T1-2", "T1-3"]);
  });

  test("treatment names and observation unit codes are unique", async () => {
    const version = await trainedVersion("exp-unique");
    const experiment = await createExperiment({
      name: "Unique",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const control = await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factor: null,
      note: "",
      replicates: 1,
    });
    const treated = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factor: null,
      note: "",
      replicates: 1,
    });

    await expect(
      addTreatment({
        experiment: experiment.id,
        name: "ck",
        factor: null,
        note: "",
        replicates: 1,
      }),
    ).rejects.toThrow(TreatmentRejectedError);
    await expect(
      updateTreatment({
        experiment: experiment.id,
        treatment: treated.id,
        name: "CK",
        factor: null,
        note: "",
      }),
    ).rejects.toThrow(TreatmentRejectedError);
    await expect(
      addObservationUnits({
        experiment: experiment.id,
        treatment: null,
        codes: ["CK-1"],
      }),
    ).rejects.toThrow(ObservationUnitRejectedError);
    await expect(
      addObservationUnits({
        experiment: experiment.id,
        treatment: randomUUID(),
        codes: ["X1"],
      }),
    ).rejects.toThrow(TreatmentNotFoundError);
    await addObservationUnits({
      experiment: experiment.id,
      treatment: null,
      codes: ["A-1"],
    });
    await expect(
      addObservationUnits({
        experiment: experiment.id,
        treatment: null,
        codes: ["a_1"],
      }),
    ).rejects.toThrow(ObservationUnitRejectedError);

    await assignObservationUnits({
      experiment: experiment.id,
      observationUnits: (await readExperimentGrid(
        experiment.id,
      ))!.observationUnits.map((observationUnit) => observationUnit.id),
      treatment: treated.id,
    });
    await expect(
      assignObservationUnits({
        experiment: experiment.id,
        observationUnits: [randomUUID()],
        treatment: treated.id,
      }),
    ).rejects.toThrow(ObservationUnitNotFoundError);

    await deleteTreatment({
      experiment: experiment.id,
      treatment: control.id,
    });
    const after = await readExperimentGrid(experiment.id);
    expect(after?.treatments).toEqual([{ ...treated, position: 1 }]);
    expect(
      after?.observationUnits.map(
        (observationUnit) => observationUnit.treatment,
      ),
    ).toEqual([treated.id, treated.id, treated.id]);
  });

  test("an observation unit keeps its images when its code is corrected", async () => {
    const version = await trainedVersion("exp-rename");
    const experiment = await createExperiment({
      name: "Typo",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await assignImages(experiment.id, observation.id, observationUnits, {
      A1: "r-a1",
    });

    const renamed = await updateObservationUnit({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A1")!,
      code: "A01",
    });
    expect(renamed.code).toBe("A01");
    await expect(
      updateObservationUnit({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A2")!,
        code: "A01",
      }),
    ).rejects.toThrow(ObservationUnitRejectedError);

    const grid = await readExperimentGrid(experiment.id);
    expect(
      grid?.observationUnits.map((observationUnit) => observationUnit.code),
    ).toEqual(["A01", "A2"]);
    expect(grid?.images).toHaveLength(1);
    expect(grid?.images[0]?.observationUnit).toBe(observationUnits.get("A1")!);
  });

  test("observations are dated once and ordered by the day they happened", async () => {
    const version = await trainedVersion("exp-observations");
    const experiment = await createExperiment({
      name: "Series",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A2",
      "A10",
      "B1",
    ]);

    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "First look",
    });
    expect([day7.ordinal, day7.day, day7.note]).toEqual([1, 7, "First look"]);

    const day21 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-22",
      note: "",
    });
    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-15",
        note: "",
      }),
    ).rejects.toThrow(ObservationRejectedError);

    await assignImages(experiment.id, day7.id, observationUnits, {
      A2: "s-a2-7",
      A10: "s-a10-7",
      B1: "s-b1-7",
    });
    await assignImages(experiment.id, day14.id, observationUnits, {
      A2: "s-a2-14",
    });

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map(({ id, day }) => [id, day])).toEqual([
      [day7.id, 7],
      [day14.id, 14],
      [day21.id, 21],
    ]);
    expect(
      grid?.observationUnits.map((observationUnit) => observationUnit.code),
    ).toEqual(["A2", "A10", "B1"]);
    expect(grid?.images).toHaveLength(4);

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.latestDay).toBe(21);
    expect(summary?.counts).toEqual({ pending: 4, failed: 0, analyzed: 0 });
  });

  test("observations cannot precede inoculation at either boundary", async () => {
    const version = await trainedVersion("exp-dates");
    const experiment = await createExperiment({
      name: "Dates",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-07-31",
        note: "",
      }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      (async () => {
        await (await database()).insert(experimentObservations).values({
          experimentId: experiment.id,
          id: randomUUID(),
          inoculatedOn: INOCULATED,
          observedOn: "2026-07-31",
          note: "",
          createdAt: new Date(),
        });
      })(),
    ).rejects.toThrow();
  });

  test("the notebook stays editable after an observation is added", async () => {
    const version = await trainedVersion("exp-notebook");
    const experiment = await createExperiment({
      name: "Notebook",
      plantMaterial: "Arabidopsis",
      explantType: "Leaf discs",
      baseMedium: "MS",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
    await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });

    const added = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factor: null,
      note: "",
      replicates: 1,
    });
    expect(added.name).toBe("T1");
    await assignObservationUnits({
      experiment: experiment.id,
      observationUnits: [observationUnits.get("A1")!],
      treatment: null,
    });
    const protocol = await updateExperiment({
      experiment: experiment.id,
      name: experiment.name,
      plantMaterial: experiment.plantMaterial,
      explantType: experiment.explantType,
      baseMedium: "B5",
      notes: experiment.notes,
      inoculatedOn: experiment.inoculatedOn,
    });
    expect(protocol.baseMedium).toBe("B5");
    await expect(
      updateExperiment({
        experiment: experiment.id,
        name: experiment.name,
        plantMaterial: experiment.plantMaterial,
        explantType: experiment.explantType,
        baseMedium: "B5",
        notes: experiment.notes,
        inoculatedOn: "2026-08-09",
      }),
    ).rejects.toThrow(ObservationRejectedError);

    const annotated = await updateExperiment({
      experiment: experiment.id,
      name: "Notebook, first run",
      plantMaterial: experiment.plantMaterial,
      explantType: experiment.explantType,
      baseMedium: "B5",
      notes: "Protocol note corrected",
      inoculatedOn: experiment.inoculatedOn,
    });
    expect([annotated.name, annotated.notes]).toEqual([
      "Notebook, first run",
      "Protocol note corrected",
    ]);

    const treatment = (await readExperimentGrid(experiment.id))!.treatments[0]!;
    const described = await updateTreatment({
      experiment: experiment.id,
      treatment: treatment.id,
      name: treatment.name,
      factor: { name: "6-BA", level: "1.0", unit: "mg/L" },
      note: "Recorded from the notebook afterwards",
    });
    expect(formatFactor(described.factor)).toBe("6-BA 1.0 mg/L");
    const renamed = await updateObservationUnit({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A1")!,
      code: "A1a",
    });
    expect(renamed.code).toBe("A1a");
    await deleteObservationUnit({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A1")!,
    });
    expect(
      (await readExperimentGrid(experiment.id))?.observationUnits.map(
        (observationUnit) => observationUnit.code,
      ),
    ).toEqual(["A2", "T1-1"]);
  });

  test("image assignment rejects duplicate units, filled cells, and reused images", async () => {
    const version = await trainedVersion("exp-assignment");
    const experiment = await createExperiment({
      name: "Image assignment",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
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
    const [first, other] = await storeTexts(["f-a1", "f-a2"]);

    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            observationUnit: observationUnits.get("A1")!,
            digest: first!,
            filename: "one.jpg",
          },
          {
            observationUnit: observationUnits.get("A1")!,
            digest: other!,
            filename: "two.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            observationUnit: observationUnits.get("A1")!,
            digest: first!,
            filename: "one.jpg",
          },
          {
            observationUnit: observationUnits.get("A2")!,
            digest: first!,
            filename: "two.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            observationUnit: randomUUID(),
            digest: first!,
            filename: "one.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationUnitNotFoundError);

    const assigned = await assignObservationImages({
      experiment: experiment.id,
      observation: day7.id,
      images: [
        {
          observationUnit: observationUnits.get("A1")!,
          digest: first!,
          filename: "IMG_0413.jpg",
        },
      ],
    });
    expect([assigned.assigned, assigned.observation.day]).toEqual([1, 7]);

    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day7.id,
        images: [
          {
            observationUnit: observationUnits.get("A1")!,
            digest: other!,
            filename: "again.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);

    try {
      await assignObservationImages({
        experiment: experiment.id,
        observation: day14.id,
        images: [
          {
            observationUnit: observationUnits.get("A2")!,
            digest: first!,
            filename: "reuse.jpg",
          },
        ],
      });
      throw new Error("Expected reused image to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentObservationImageAlreadyUsedError);
      expect(
        (error as ExperimentObservationImageAlreadyUsedError).images,
      ).toEqual([
        {
          digest: first!,
          filename: "IMG_0413.jpg",
          observationUnit: "A1",
          day: 7,
        },
      ]);
    }
    expect((await readExperimentGrid(experiment.id))?.images).toHaveLength(1);
  });

  test("an image assigned to the wrong cell can be reassigned or unassigned", async () => {
    const version = await trainedVersion("exp-reassign");
    const experiment = await createExperiment({
      name: "Refile",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await assignImages(experiment.id, day7.id, observationUnits, {
      A1: "w-a1",
      A2: "w-a2",
    });
    const images = await imagesByObservationUnit(experiment.id);

    await expect(
      moveObservationImage({
        experiment: experiment.id,
        observationImage: images.get("A1")!,
        observationUnit: observationUnits.get("A2")!,
        observation: day7.id,
      }),
    ).rejects.toThrow(ObservationImageRejectedError);

    await unassignObservationImage({
      experiment: experiment.id,
      observationImage: images.get("A2")!,
    });
    await moveObservationImage({
      experiment: experiment.id,
      observationImage: images.get("A1")!,
      observationUnit: observationUnits.get("A2")!,
      observation: day7.id,
    });

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.images.map((image) => image.observationUnit)).toEqual([
      observationUnits.get("A2")!,
    ]);
    expect(
      await blobExists(imageBlobKey(await imageDigest("w-a2"))),
    ).toBeTrue();
  });

  test("an observation unit has at most one active terminal event", async () => {
    const version = await trainedVersion("exp-terminal-events");
    const experiment = await createExperiment({
      name: "Terminal events",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
    ]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });

    const results = await Promise.allSettled([
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A1")!,
        type: "discarded",
        observation: day7.id,
        excludeFromObservation: false,
        note: "Discarded after imaging",
      }),
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A1")!,
        type: "harvested",
        observation: day7.id,
        excludeFromObservation: false,
        note: "Harvested after imaging",
      }),
    ]);
    const recorded = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(recorded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ObservationUnitRejectedError);

    await voidCultureEvent({
      experiment: experiment.id,
      event: recorded[0]!.value.id,
      reason: "Wrong terminal event",
    });
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A1")!,
        type: "missing",
        observation: day7.id,
        excludeFromObservation: true,
        note: "Unit could not be located",
      }),
    ).resolves.toMatchObject({ type: "missing" });
  });

  test("culture events preserve their effects and corrections", async () => {
    const version = await trainedVersion("exp-missing");
    const experiment = await createExperiment({
      name: "Contamination",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });

    const event = await recordCultureEvent({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A1")!,
      type: "contaminated",
      observation: day7.id,
      excludeFromObservation: true,
      note: "Fungus on the medium",
    });
    expect([
      event.type,
      event.observation,
      event.excludeFromObservation,
      event.note,
    ]).toEqual(["contaminated", day7.id, true, "Fungus on the medium"]);
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A1")!,
        type: "contaminated",
        observation: day7.id,
        excludeFromObservation: true,
        note: "Duplicate",
      }),
    ).rejects.toThrow(ObservationUnitRejectedError);

    const corrected = await voidCultureEvent({
      experiment: experiment.id,
      event: event.id,
      reason: "Culture was clean on review",
    });
    expect(corrected.voidedAt).not.toBeNull();
    expect(corrected.voidReason).toBe("Culture was clean on review");

    const day14 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-15",
      note: "",
    });
    const terminalEvent = await recordCultureEvent({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A1")!,
      type: "discarded",
      observation: day7.id,
      excludeFromObservation: false,
      note: "Discarded after imaging",
    });
    const [futurePhoto] = await storeTexts(["terminal-a1"]);
    await expect(
      assignObservationImages({
        experiment: experiment.id,
        observation: day14.id,
        images: [
          {
            observationUnit: observationUnits.get("A1")!,
            digest: futurePhoto!,
            filename: "A1.jpg",
          },
        ],
      }),
    ).rejects.toThrow(ObservationImageRejectedError);
    await voidCultureEvent({
      experiment: experiment.id,
      event: terminalEvent.id,
      reason: "Observation unit was retained",
    });
    await assignObservationImages({
      experiment: experiment.id,
      observation: day14.id,
      images: [
        {
          observationUnit: observationUnits.get("A1")!,
          digest: futurePhoto!,
          filename: "A1.jpg",
        },
      ],
    });

    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A1")!,
        type: "harvested",
        observation: day7.id,
        excludeFromObservation: false,
        note: "",
      }),
    ).rejects.toThrow("has records after this observation");

    await recordCultureEvent({
      experiment: experiment.id,
      observationUnit: observationUnits.get("A2")!,
      type: "contaminated",
      observation: day14.id,
      excludeFromObservation: false,
      note: "Late contamination",
    });
    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A2")!,
        type: "discarded",
        observation: day7.id,
        excludeFromObservation: false,
        note: "",
      }),
    ).rejects.toThrow("has records after this observation");

    await expect(
      recordCultureEvent({
        experiment: experiment.id,
        observationUnit: randomUUID(),
        type: "missing",
        observation: day7.id,
        excludeFromObservation: true,
        note: "",
      }),
    ).rejects.toThrow(ObservationUnitNotFoundError);

    const rows = await (
      await database()
    )
      .select()
      .from(experimentCultureEvents);
    expect(
      rows.some((row) => row.id === event.id && row.voidedAt !== null),
    ).toBeTrue();
  });

  test("analyzes images under the experiment version and exposes tallies", async () => {
    const version = await trainedVersion("exp-metrics");
    const experiment = await createExperiment({
      name: "Metrics",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "D1",
      "D2",
    ]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await assignImages(experiment.id, day7.id, observationUnits, {
      D1: "c-d1",
      D2: "c-d2",
    });
    const d1 = await imageDigest("c-d1");
    const d2 = await imageDigest("c-d2");

    const assignment = (await pendingAssignments(worker)).find(
      (item) => item.manifest.modelVersionId === version.id,
    );
    expect(assignment?.images.sort()).toEqual([d1, d2].sort());
    expect(
      (
        await pendingAssignments({
          runtimes: testHeartbeat("traditional").runtimes,
        })
      ).some((item) => item.manifest.modelVersionId === version.id),
    ).toBeFalse();

    await recordInferenceOutcome(
      { versionId: version.id, digest: d1 },
      resultFor(version, d1, 3),
      worker,
    );
    await recordInferenceOutcome(
      { versionId: version.id, digest: d2 },
      failureFor(version, d2),
      worker,
    );
    const grid = await readExperimentGrid(experiment.id);
    const codes = new Map(
      grid!.observationUnits.map((observationUnit) => [
        observationUnit.id,
        observationUnit.code,
      ]),
    );
    expect(
      grid?.images
        .map((image) => [
          codes.get(image.observationUnit)!,
          image.state,
          image.detectionTally,
          image.error,
        ])
        .sort(),
    ).toEqual([
      ["D1", "analyzed", { seed: 3 }, null],
      ["D2", "failed", null, "no observation unit found"],
    ]);

    const images = await imagesByObservationUnit(experiment.id);
    const failed = {
      experiment: experiment.id,
      observationImage: images.get("D2")!,
    };
    await retryObservationImageAnalysis(failed);
    expect(
      (await pendingAssignments(worker)).find(
        (item) => item.manifest.modelVersionId === version.id,
      )?.images,
    ).toEqual([d2]);
    expect((await readExperimentObservationImage(failed))?.failure).toBeNull();
    expect(
      (await readExperimentObservationImage(failed))?.observation.day,
    ).toBe(7);
    expect(
      (await readExperimentObservationImage(failed))?.observationUnit.code,
    ).toBe("D2");
    expect(
      (
        await readExperimentObservationImage({
          experiment: experiment.id,
          observationImage: images.get("D1")!,
        })
      )?.detection?.instances,
    ).toHaveLength(3);
  });

  test("an observation unit page shows its newest image and supports unit navigation", async () => {
    const version = await trainedVersion("exp-observation-unit");
    const experiment = await createExperiment({
      name: "Observation unit series",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "S1",
      "S2",
    ]);
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
    await assignImages(experiment.id, day7.id, observationUnits, {
      S1: "s-d1-s1",
      S2: "s-d1-s2",
    });
    await assignImages(experiment.id, day14.id, observationUnits, {
      S1: "s-d3-s1",
    });
    const ref = {
      experiment: experiment.id,
      observationUnit: observationUnits.get("S1")!,
    };

    const newest = await readObservationUnit(ref);
    expect(newest?.model.metrics[0]?.id).toBe("seeds");
    expect(newest?.shown?.observation.id).toBe(day14.id);
    expect(
      newest?.observations.map((item) => item.image?.state ?? null),
    ).toEqual(["pending", "pending"]);
    expect(newest?.navigation.map((item) => item.code)).toEqual(["S1", "S2"]);

    const earlier = await readObservationUnit(ref, day7.id);
    expect(earlier?.shown?.digest).toBe(await imageDigest("s-d1-s1"));

    const lonely = await readObservationUnit({
      ...ref,
      observationUnit: observationUnits.get("S2")!,
    });
    expect(lonely?.shown?.observation.id).toBe(day7.id);
    expect(lonely?.observations[1]?.image).toBeNull();
    expect(
      await readObservationUnit(
        { ...ref, observationUnit: observationUnits.get("S2")! },
        day14.id,
      ),
    ).toBeNull();
    expect(
      await readObservationUnit({
        ...ref,
        observationUnit: randomUUID(),
      }),
    ).toBeNull();
  });

  test("images keep their observation units, and experiments without them can be deleted", async () => {
    const version = await trainedVersion("exp-maint");
    const experiment = await createExperiment({
      name: "Draft",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "A1",
      "A2",
    ]);
    const revised = await updateExperiment({
      experiment: experiment.id,
      name: "Final",
      plantMaterial: "Tobacco BY-2",
      explantType: "Leaf discs",
      baseMedium: "MS + 3% sucrose",
      notes: "Draft protocol",
      inoculatedOn: "2026-08-02",
    });
    expect([revised.name, revised.inoculatedOn]).toEqual([
      "Final",
      "2026-08-02",
    ]);
    expect(revised.modelVersionId).toBe(version.id);

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
    await assignImages(experiment.id, day7.id, observationUnits, {
      A1: "m-a1-1",
      A2: "m-a2-1",
    });
    expect(
      (await readExperimentGrid(experiment.id))?.observations[0]?.day,
    ).toBe(6);

    await expect(
      updateObservation({
        experiment: experiment.id,
        observation: day14.id,
        observedOn: "2026-08-08",
        note: "",
      }),
    ).rejects.toThrow(ObservationRejectedError);
    const redatedEmpty = await updateObservation({
      experiment: experiment.id,
      observation: day14.id,
      observedOn: "2026-08-29",
      note: "Final count",
    });
    expect([
      redatedEmpty.observedOn,
      redatedEmpty.day,
      redatedEmpty.note,
    ]).toEqual(["2026-08-29", 27, "Final count"]);
    const redatedRecorded = await updateObservation({
      experiment: experiment.id,
      observation: day7.id,
      observedOn: "2026-08-09",
      note: "Images checked",
    });
    expect([
      redatedRecorded.observedOn,
      redatedRecorded.day,
      redatedRecorded.note,
    ]).toEqual(["2026-08-09", 7, "Images checked"]);
    expect((await readExperimentGrid(experiment.id))?.images).toHaveLength(2);

    await deleteObservation({
      experiment: experiment.id,
      observation: day14.id,
    });
    await expect(
      deleteObservation({ experiment: experiment.id, observation: day7.id }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      deleteObservationUnit({
        experiment: experiment.id,
        observationUnit: observationUnits.get("A2")!,
      }),
    ).rejects.toThrow(ObservationUnitRejectedError);
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map((item) => item.id)).toEqual([day7.id]);
    expect(
      grid?.observationUnits.map((observationUnit) => observationUnit.code),
    ).toEqual(["A1", "A2"]);
    expect(grid?.images).toHaveLength(2);
    const first = await imageDigest("m-a1-1");
    expect(await blobExists(imageBlobKey(first))).toBeTrue();

    await expect(
      deleteExperiment({ experiment: experiment.id }),
    ).rejects.toThrow(ExperimentHasRecordsError);

    const disposable = await createExperiment({
      name: "Disposable draft",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    await deleteExperiment({ experiment: disposable.id });
    expect(await readExperiment(disposable.id)).toBeNull();
    await expect(
      deleteExperiment({ experiment: disposable.id }),
    ).rejects.toThrow(ExperimentNotFoundError);
    expect(await blobExists(imageBlobKey(first))).toBeTrue();
  });

  test("two experiments analyzing one image with one version share one inference", async () => {
    const version = await trainedVersion("exp-shared");
    const [digest] = await storeTexts(["shared-image"]);
    for (const name of ["Shared demand A", "Shared demand B"]) {
      const experiment = await createExperiment({
        name,
        inoculatedOn: INOCULATED,
        modelVersionId: version.id,
      });
      const observationUnits = await defineObservationUnits(experiment.id, [
        "S1",
      ]);
      const observation = await addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
      });
      await assignObservationImages({
        experiment: experiment.id,
        observation: observation.id,
        images: [
          {
            observationUnit: observationUnits.get("S1")!,
            digest: digest!,
            filename: "S1.jpg",
          },
        ],
      });
    }

    const assignment = (await pendingAssignments(worker)).find(
      (item) => item.manifest.modelVersionId === version.id,
    );
    expect(assignment?.images).toEqual([digest]);
  });

  test("the database binds failure documents to the registered artifact", async () => {
    const version = await trainedVersion("exp-failure-fk");
    const [digest] = await storeTexts(["failure-fk"]);
    const failure = failureFor(version, digest!);

    const invalidFailure = (async () => {
      await (await database()).insert(inferenceOutcomes).values({
        imageId: digest!,
        modelVersionId: version.id,
        document: {
          ...failure,
          producer: {
            ...failure.producer,
            artifactDigest: "f".repeat(64),
          },
        },
        recordedAt: new Date(),
      });
    })();
    await expect(invalidFailure).rejects.toThrow();
  });

  test("an experiment observation image is a garbage-collection root", async () => {
    const version = await trainedVersion("exp-gc");
    const experiment = await createExperiment({
      name: "GC",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const observationUnits = await defineObservationUnits(experiment.id, [
      "E1",
    ]);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await assignImages(experiment.id, observation.id, observationUnits, {
      E1: "gc-e1",
    });
    const kept = await imageDigest("gc-e1");
    const [loose] = await storeTexts(["gc-loose"]);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const collected = await collectImages(later);

    expect(collected).toContain(loose!);
    expect(collected).not.toContain(kept);
    expect(await blobExists(imageBlobKey(kept))).toBeTrue();
  });
});
