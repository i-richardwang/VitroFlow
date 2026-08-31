import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { database } from "../db/client";
import {
  experimentDishEvents,
  experimentDishes,
  experimentObservations,
  experiments,
  inferenceOutcomes,
} from "../db/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import type { ModelVersion } from "../models/schema";
import {
  DishNotFoundError,
  DishRejectedError,
  ExperimentDesignIncompleteError,
  ExperimentDesignLockedError,
  ExperimentHasRecordsError,
  ExperimentNotFoundError,
  ExperimentPhotoAlreadyUsedError,
  PhotoRejectedError,
  ObservationRejectedError,
  TreatmentNotFoundError,
  TreatmentRejectedError,
} from "../experiments/errors";
import {
  experimentRequestSchema,
  calendarDaySchema,
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
  addDishes,
  addTreatment,
  addTreatmentReplicates,
  assignDishes,
  createExperiment as createExperimentRecord,
  deleteDish,
  deleteExperiment,
  deleteTreatment,
  readExperiment,
  updateDish,
  updateTreatment,
  updateExperiment,
} from "./experiment-design";
import { recordDishEvent, voidDishEvent } from "./experiment-events";
import {
  addObservation,
  deleteObservation,
  filePhotos,
  movePhoto,
  removePhoto,
  retryExperimentDetection,
  updateObservation,
} from "./experiment-observations";
import {
  listExperiments,
  readExperimentDish,
  readExperimentGrid,
  readExperimentPhoto,
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
    readings: [
      { id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] },
    ],
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
    error: "no dish found",
  };
}

async function layOut(
  experiment: string,
  labels: string[],
): Promise<Map<string, string>> {
  const treatment = await addTreatment({
    experiment,
    name: "Test",
    factors: [],
    note: "",
    replicates: 0,
    initialExplantCount: 1,
  });
  const dishes = await addDishes({
    experiment,
    treatment: treatment.id,
    labels,
    initialExplantCount: 1,
  });
  return new Map(dishes.map((dish) => [dish.label, dish.id]));
}

/** Photographs the named dishes in one observation, one image per dish. */
async function photograph(
  experiment: string,
  observation: string,
  dishes: Map<string, string>,
  contents: Record<string, string>,
) {
  const entries = Object.entries(contents);
  const digests = await storeTexts(entries.map(([, content]) => content));
  return filePhotos({
    experiment,
    observation,
    photos: entries.map(([label], index) => ({
      dish: dishes.get(label)!,
      digest: digests[index]!,
      filename: `${label}.jpg`,
    })),
  });
}

/** The photograph filed under each dish label, across every observation. */
async function photosByDish(experiment: string): Promise<Map<string, string>> {
  const grid = await readExperimentGrid(experiment);
  const labels = new Map(grid!.dishes.map((dish) => [dish.id, dish.label]));
  return new Map(
    grid!.photos.map((photo) => [labels.get(photo.dish)!, photo.id]),
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
        material: "",
        explant: "",
        medium: "",
        notes: "",
        inoculatedOn: INOCULATED,
        modelVersionId: "nobody.v9",
        createdAt: new Date(),
      });
    })();
    await expect(unknownVersion).rejects.toThrow();

    const invalidDish = (async () => {
      await (await database()).insert(experimentDishes).values({
        experimentId: first.id,
        id: randomUUID(),
        label: " A1 ",
        initialExplantCount: 1,
      });
    })();
    await expect(invalidDish).rejects.toThrow();

    const invalidExplantCount = (async () => {
      await (await database()).insert(experimentDishes).values({
        experimentId: first.id,
        id: randomUUID(),
        label: "A2",
        initialExplantCount: 0,
      });
    })();
    await expect(invalidExplantCount).rejects.toThrow();
  });

  test("the design lays out dishes before any photograph exists", async () => {
    const version = await trainedVersion("exp-design");
    const experiment = await createExperiment({
      name: "Hormones",
      material: "  Arabidopsis Col-0  ",
      explant: "Seeds",
      medium: "MS",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    expect(experiment.material).toBe("Arabidopsis Col-0");
    expect([experiment.explant, experiment.medium]).toEqual(["Seeds", "MS"]);
    expect(experiment.notes).toBe("");

    const control = await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factors: [],
      note: "Hormone-free MS",
      replicates: 2,
      initialExplantCount: 4,
    });
    const auxin = await addTreatment(
      treatmentRequestSchema.parse({
        experiment: experiment.id,
        name: " T1 ",
        factors: [{ name: " 6-BA ", level: "1.0", unit: " mg/L " }],
        replicates: 3,
      }),
    );
    expect([control.position, auxin.position]).toEqual([1, 2]);
    expect(auxin.name).toBe("T1");
    expect(auxin.factors).toEqual([
      { name: "6-BA", level: "1.0", unit: "mg/L" },
    ]);

    const empty = await readExperimentGrid(experiment.id);
    expect(empty?.observations).toEqual([]);
    expect(empty?.dishes.map((dish) => [dish.label, dish.position])).toEqual([
      ["CK-1", 1],
      ["CK-2", 2],
      ["T1-1", 3],
      ["T1-2", 4],
      ["T1-3", 5],
    ]);
    expect(
      empty?.dishes.every(
        (dish) => dish.initialExplantCount >= 1 && dish.events.length === 0,
      ),
    ).toBeTrue();

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect([
      summary?.treatments,
      summary?.dishes,
      summary?.observations,
    ]).toEqual([2, 5, 0]);
  });

  test("an observation starts only from a complete experimental design", async () => {
    const version = await trainedVersion("exp-complete-design");
    const experiment = await createExperiment({
      name: "Complete design",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const treatment = await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factors: [],
      note: "",
      replicates: 0,
      initialExplantCount: 1,
    });
    await addDishes({
      experiment: experiment.id,
      treatment: null,
      labels: ["A1"],
      initialExplantCount: 1,
    });

    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
      }),
    ).rejects.toThrow(ExperimentDesignIncompleteError);

    const [dish] = (await readExperimentGrid(experiment.id))!.dishes;
    await assignDishes({
      experiment: experiment.id,
      dishes: [dish!.id],
      treatment: treatment.id,
    });
    await expect(
      addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
      }),
    ).resolves.toMatchObject({ day: 7 });
  });

  test("replicate labels and initial explant counts are owned by the design service", async () => {
    const version = await trainedVersion("exp-replicates");
    const experiment = await createExperiment({
      name: "Replicates",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const treatment = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factors: [],
      note: "",
      replicates: 1,
      initialExplantCount: 3,
    });
    await Promise.all([
      addTreatmentReplicates({
        experiment: experiment.id,
        treatment: treatment.id,
        replicates: 2,
        initialExplantCount: 4,
      }),
      addTreatmentReplicates({
        experiment: experiment.id,
        treatment: treatment.id,
        replicates: 2,
        initialExplantCount: 5,
      }),
    ]);
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.dishes.map((dish) => dish.label)).toEqual([
      "T1-1",
      "T1-2",
      "T1-3",
      "T1-4",
      "T1-5",
    ]);

    const dish = grid!.dishes[0]!;
    const updated = await updateDish({
      experiment: experiment.id,
      dish: dish.id,
      label: dish.label,
      initialExplantCount: 7,
    });
    expect(updated.initialExplantCount).toBe(7);
  });

  test("treatments are named once and dishes are labelled once", async () => {
    const version = await trainedVersion("exp-unique");
    const experiment = await createExperiment({
      name: "Unique",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const control = await addTreatment({
      experiment: experiment.id,
      name: "CK",
      factors: [],
      note: "",
      replicates: 1,
      initialExplantCount: 1,
    });
    const treated = await addTreatment({
      experiment: experiment.id,
      name: "T1",
      factors: [],
      note: "",
      replicates: 0,
      initialExplantCount: 1,
    });

    await expect(
      addTreatment({
        experiment: experiment.id,
        name: "ck",
        factors: [],
        note: "",
        replicates: 0,
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(TreatmentRejectedError);
    await expect(
      updateTreatment({
        experiment: experiment.id,
        treatment: treated.id,
        name: "CK",
        factors: [],
        note: "",
      }),
    ).rejects.toThrow(TreatmentRejectedError);
    await expect(
      addDishes({
        experiment: experiment.id,
        treatment: null,
        labels: ["CK-1"],
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(DishRejectedError);
    await expect(
      addDishes({
        experiment: experiment.id,
        treatment: randomUUID(),
        labels: ["X1"],
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(TreatmentNotFoundError);
    await addDishes({
      experiment: experiment.id,
      treatment: null,
      labels: ["A-1"],
      initialExplantCount: 1,
    });
    await expect(
      addDishes({
        experiment: experiment.id,
        treatment: null,
        labels: ["a_1"],
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(DishRejectedError);

    await assignDishes({
      experiment: experiment.id,
      dishes: (await readExperimentGrid(experiment.id))!.dishes.map(
        (dish) => dish.id,
      ),
      treatment: treated.id,
    });
    await expect(
      assignDishes({
        experiment: experiment.id,
        dishes: [randomUUID()],
        treatment: treated.id,
      }),
    ).rejects.toThrow(DishNotFoundError);

    await deleteTreatment({
      experiment: experiment.id,
      treatment: control.id,
    });
    const after = await readExperimentGrid(experiment.id);
    expect(after?.treatments).toEqual([{ ...treated, position: 1 }]);
    expect(after?.dishes.map((dish) => dish.treatment)).toEqual([
      treated.id,
      treated.id,
    ]);
  });

  test("a dish keeps its photographs when its label is corrected", async () => {
    const version = await trainedVersion("exp-rename");
    const experiment = await createExperiment({
      name: "Typo",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await photograph(experiment.id, observation.id, dishes, { A1: "r-a1" });

    const renamed = await updateDish({
      experiment: experiment.id,
      dish: dishes.get("A1")!,
      label: "A01",
      initialExplantCount: 1,
    });
    expect(renamed.label).toBe("A01");
    await expect(
      updateDish({
        experiment: experiment.id,
        dish: dishes.get("A2")!,
        label: "A01",
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(DishRejectedError);

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.dishes.map((dish) => dish.label)).toEqual(["A01", "A2"]);
    expect(grid?.photos).toHaveLength(1);
    expect(grid?.photos[0]?.dish).toBe(dishes.get("A1")!);
  });

  test("observations are dated once and ordered by the day they happened", async () => {
    const version = await trainedVersion("exp-observations");
    const experiment = await createExperiment({
      name: "Series",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A2", "A10", "B1"]);

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

    await photograph(experiment.id, day7.id, dishes, {
      A2: "s-a2-7",
      A10: "s-a10-7",
      B1: "s-b1-7",
    });
    await photograph(experiment.id, day14.id, dishes, { A2: "s-a2-14" });

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map(({ id, day }) => [id, day])).toEqual([
      [day7.id, 7],
      [day14.id, 14],
      [day21.id, 21],
    ]);
    expect(grid?.dishes.map((dish) => dish.label)).toEqual(["A2", "A10", "B1"]);
    expect(grid?.photos).toHaveLength(4);

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.observations).toBe(3);
    expect(summary?.counts).toEqual({ pending: 4, failed: 0, observed: 0 });
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

  test("the first observation fixes the structural design", async () => {
    const version = await trainedVersion("exp-fixed-design");
    const experiment = await createExperiment({
      name: "Fixed design",
      material: "Arabidopsis",
      explant: "Leaf discs",
      medium: "MS",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
    await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });

    await expect(
      addTreatment({
        experiment: experiment.id,
        name: "T1",
        factors: [],
        note: "",
        replicates: 1,
        initialExplantCount: 1,
      }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    await expect(
      assignDishes({
        experiment: experiment.id,
        dishes: [dishes.get("A1")!],
        treatment: null,
      }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    await expect(
      deleteDish({ experiment: experiment.id, dish: dishes.get("A1")! }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    await expect(
      updateDish({
        experiment: experiment.id,
        dish: dishes.get("A1")!,
        label: "A1",
        initialExplantCount: 2,
      }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    await expect(
      updateExperiment({
        experiment: experiment.id,
        name: experiment.name,
        material: experiment.material,
        explant: experiment.explant,
        medium: "B5",
        notes: experiment.notes,
        inoculatedOn: experiment.inoculatedOn,
      }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    await expect(
      deleteExperiment({ experiment: experiment.id }),
    ).rejects.toThrow(ExperimentHasRecordsError);

    const annotated = await updateExperiment({
      experiment: experiment.id,
      name: "Fixed design, first run",
      material: experiment.material,
      explant: experiment.explant,
      medium: experiment.medium,
      notes: "Protocol note corrected",
      inoculatedOn: experiment.inoculatedOn,
    });
    expect([annotated.name, annotated.notes]).toEqual([
      "Fixed design, first run",
      "Protocol note corrected",
    ]);
  });

  test("filing refuses a dish twice, a filled cell, and a photograph already used", async () => {
    const version = await trainedVersion("exp-filing");
    const experiment = await createExperiment({
      name: "Filing",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
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
      filePhotos({
        experiment: experiment.id,
        observation: day7.id,
        photos: [
          { dish: dishes.get("A1")!, digest: first!, filename: "one.jpg" },
          { dish: dishes.get("A1")!, digest: other!, filename: "two.jpg" },
        ],
      }),
    ).rejects.toThrow(PhotoRejectedError);
    await expect(
      filePhotos({
        experiment: experiment.id,
        observation: day7.id,
        photos: [
          { dish: dishes.get("A1")!, digest: first!, filename: "one.jpg" },
          { dish: dishes.get("A2")!, digest: first!, filename: "two.jpg" },
        ],
      }),
    ).rejects.toThrow(PhotoRejectedError);
    await expect(
      filePhotos({
        experiment: experiment.id,
        observation: day7.id,
        photos: [{ dish: randomUUID(), digest: first!, filename: "one.jpg" }],
      }),
    ).rejects.toThrow(DishNotFoundError);

    const filed = await filePhotos({
      experiment: experiment.id,
      observation: day7.id,
      photos: [
        { dish: dishes.get("A1")!, digest: first!, filename: "IMG_0413.jpg" },
      ],
    });
    expect([filed.photos, filed.observation.day]).toEqual([1, 7]);

    await expect(
      filePhotos({
        experiment: experiment.id,
        observation: day7.id,
        photos: [
          { dish: dishes.get("A1")!, digest: other!, filename: "again.jpg" },
        ],
      }),
    ).rejects.toThrow(PhotoRejectedError);

    try {
      await filePhotos({
        experiment: experiment.id,
        observation: day14.id,
        photos: [
          { dish: dishes.get("A2")!, digest: first!, filename: "reuse.jpg" },
        ],
      });
      throw new Error("Expected reused photo to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentPhotoAlreadyUsedError);
      expect((error as ExperimentPhotoAlreadyUsedError).photos).toEqual([
        { digest: first!, filename: "IMG_0413.jpg", dish: "A1", day: 7 },
      ]);
    }
    expect((await readExperimentGrid(experiment.id))?.photos).toHaveLength(1);
  });

  test("a photograph filed under the wrong cell is refiled or taken back", async () => {
    const version = await trainedVersion("exp-refile");
    const experiment = await createExperiment({
      name: "Refile",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await photograph(experiment.id, day7.id, dishes, {
      A1: "w-a1",
      A2: "w-a2",
    });
    const photos = await photosByDish(experiment.id);

    await expect(
      movePhoto({
        experiment: experiment.id,
        photo: photos.get("A1")!,
        dish: dishes.get("A2")!,
        observation: day7.id,
      }),
    ).rejects.toThrow(PhotoRejectedError);

    await removePhoto({
      experiment: experiment.id,
      photo: photos.get("A2")!,
    });
    await movePhoto({
      experiment: experiment.id,
      photo: photos.get("A1")!,
      dish: dishes.get("A2")!,
      observation: day7.id,
    });

    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.photos.map((photo) => photo.dish)).toEqual([
      dishes.get("A2")!,
    ]);
    expect(
      await blobExists(imageBlobKey(await imageDigest("w-a2"))),
    ).toBeTrue();
  });

  test("culture events preserve their effects and corrections", async () => {
    const version = await trainedVersion("exp-lost");
    const experiment = await createExperiment({
      name: "Contamination",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });

    const event = await recordDishEvent({
      experiment: experiment.id,
      dish: dishes.get("A1")!,
      type: "contaminated",
      observation: day7.id,
      excludeFromObservation: true,
      removeAfterObservation: false,
      note: "Fungus on the medium",
    });
    expect([
      event.type,
      event.observation,
      event.excludeFromObservation,
      event.removeAfterObservation,
      event.note,
    ]).toEqual(["contaminated", day7.id, true, false, "Fungus on the medium"]);
    await expect(
      recordDishEvent({
        experiment: experiment.id,
        dish: dishes.get("A1")!,
        type: "contaminated",
        observation: day7.id,
        excludeFromObservation: true,
        removeAfterObservation: false,
        note: "Duplicate",
      }),
    ).rejects.toThrow(DishRejectedError);

    const corrected = await voidDishEvent({
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
    const removed = await recordDishEvent({
      experiment: experiment.id,
      dish: dishes.get("A1")!,
      type: "discarded",
      observation: day7.id,
      excludeFromObservation: false,
      removeAfterObservation: true,
      note: "Harvested after imaging",
    });
    const [futurePhoto] = await storeTexts(["removed-a1"]);
    await expect(
      filePhotos({
        experiment: experiment.id,
        observation: day14.id,
        photos: [
          {
            dish: dishes.get("A1")!,
            digest: futurePhoto!,
            filename: "A1.jpg",
          },
        ],
      }),
    ).rejects.toThrow(PhotoRejectedError);
    await voidDishEvent({
      experiment: experiment.id,
      event: removed.id,
      reason: "Dish was retained",
    });
    await filePhotos({
      experiment: experiment.id,
      observation: day14.id,
      photos: [
        {
          dish: dishes.get("A1")!,
          digest: futurePhoto!,
          filename: "A1.jpg",
        },
      ],
    });

    await expect(
      recordDishEvent({
        experiment: experiment.id,
        dish: dishes.get("A1")!,
        type: "harvested",
        observation: day7.id,
        excludeFromObservation: false,
        removeAfterObservation: true,
        note: "",
      }),
    ).rejects.toThrow("has records after this observation");

    await recordDishEvent({
      experiment: experiment.id,
      dish: dishes.get("A2")!,
      type: "contaminated",
      observation: day14.id,
      excludeFromObservation: false,
      removeAfterObservation: false,
      note: "Late contamination",
    });
    await expect(
      recordDishEvent({
        experiment: experiment.id,
        dish: dishes.get("A2")!,
        type: "discarded",
        observation: day7.id,
        excludeFromObservation: false,
        removeAfterObservation: true,
        note: "",
      }),
    ).rejects.toThrow("has records after this observation");

    await expect(
      recordDishEvent({
        experiment: experiment.id,
        dish: randomUUID(),
        type: "lost",
        observation: day7.id,
        excludeFromObservation: true,
        removeAfterObservation: true,
        note: "",
      }),
    ).rejects.toThrow(DishNotFoundError);

    const rows = await (await database()).select().from(experimentDishEvents);
    expect(
      rows.some((row) => row.id === event.id && row.voidedAt !== null),
    ).toBeTrue();
  });

  test("detects photos under the experiment version and exposes tallies", async () => {
    const version = await trainedVersion("exp-readings");
    const experiment = await createExperiment({
      name: "Readings",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["D1", "D2"]);
    const day7 = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await photograph(experiment.id, day7.id, dishes, {
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
    const labels = new Map(grid!.dishes.map((dish) => [dish.id, dish.label]));
    expect(
      grid?.photos
        .map((photo) => [
          labels.get(photo.dish)!,
          photo.state,
          photo.observed,
          photo.error,
        ])
        .sort(),
    ).toEqual([
      ["D1", "observed", { seed: 3 }, null],
      ["D2", "failed", null, "no dish found"],
    ]);

    const photos = await photosByDish(experiment.id);
    const failed = { experiment: experiment.id, photo: photos.get("D2")! };
    await retryExperimentDetection(failed);
    expect(
      (await pendingAssignments(worker)).find(
        (item) => item.manifest.modelVersionId === version.id,
      )?.images,
    ).toEqual([d2]);
    expect((await readExperimentPhoto(failed))?.failure).toBeNull();
    expect((await readExperimentPhoto(failed))?.observation.day).toBe(7);
    expect((await readExperimentPhoto(failed))?.dish.label).toBe("D2");
    expect(
      (
        await readExperimentPhoto({
          experiment: experiment.id,
          photo: photos.get("D1")!,
        })
      )?.detection?.instances,
    ).toHaveLength(3);
  });

  test("a dish page shows its newest photographed observation and walks the roster", async () => {
    const version = await trainedVersion("exp-dish");
    const experiment = await createExperiment({
      name: "Dish series",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["S1", "S2"]);
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
    await photograph(experiment.id, day7.id, dishes, {
      S1: "s-d1-s1",
      S2: "s-d1-s2",
    });
    await photograph(experiment.id, day14.id, dishes, { S1: "s-d3-s1" });
    const ref = { experiment: experiment.id, dish: dishes.get("S1")! };

    const newest = await readExperimentDish(ref);
    expect(newest?.model.readings[0]?.id).toBe("seeds");
    expect(newest?.shown?.observation.id).toBe(day14.id);
    expect(
      newest?.observations.map((item) => item.photo?.state ?? null),
    ).toEqual(["pending", "pending"]);
    expect(newest?.roster.map((item) => item.label)).toEqual(["S1", "S2"]);

    const earlier = await readExperimentDish(ref, day7.id);
    expect(earlier?.shown?.digest).toBe(await imageDigest("s-d1-s1"));

    const lonely = await readExperimentDish({
      ...ref,
      dish: dishes.get("S2")!,
    });
    expect(lonely?.shown?.observation.id).toBe(day7.id);
    expect(lonely?.observations[1]?.photo).toBeNull();
    expect(
      await readExperimentDish({ ...ref, dish: dishes.get("S2")! }, day14.id),
    ).toBeNull();
    expect(await readExperimentDish({ ...ref, dish: randomUUID() })).toBeNull();
  });

  test("drafts stay editable while recorded observations preserve history", async () => {
    const version = await trainedVersion("exp-maint");
    const experiment = await createExperiment({
      name: "Draft",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["A1", "A2"]);
    const revised = await updateExperiment({
      experiment: experiment.id,
      name: "Final",
      material: "Tobacco BY-2",
      explant: "Leaf discs",
      medium: "MS + 3% sucrose",
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
    await photograph(experiment.id, day7.id, dishes, {
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
    await expect(
      updateObservation({
        experiment: experiment.id,
        observation: day7.id,
        observedOn: "2026-08-09",
        note: "",
      }),
    ).rejects.toThrow(ObservationRejectedError);
    const annotated = await updateObservation({
      experiment: experiment.id,
      observation: day7.id,
      observedOn: day7.observedOn,
      note: "Images checked",
    });
    expect(annotated.note).toBe("Images checked");

    await deleteObservation({
      experiment: experiment.id,
      observation: day14.id,
    });
    await expect(
      deleteObservation({ experiment: experiment.id, observation: day7.id }),
    ).rejects.toThrow(ObservationRejectedError);
    await expect(
      deleteDish({ experiment: experiment.id, dish: dishes.get("A2")! }),
    ).rejects.toThrow(ExperimentDesignLockedError);
    const grid = await readExperimentGrid(experiment.id);
    expect(grid?.observations.map((item) => item.id)).toEqual([day7.id]);
    expect(grid?.dishes.map((dish) => dish.label)).toEqual(["A1", "A2"]);
    expect(grid?.photos).toHaveLength(2);
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

  test("two experiments reading one photograph with one version share one pair", async () => {
    const version = await trainedVersion("exp-shared");
    const [digest] = await storeTexts(["shared-photo"]);
    for (const name of ["Shared demand A", "Shared demand B"]) {
      const experiment = await createExperiment({
        name,
        inoculatedOn: INOCULATED,
        modelVersionId: version.id,
      });
      const dishes = await layOut(experiment.id, ["S1"]);
      const observation = await addObservation({
        experiment: experiment.id,
        observedOn: "2026-08-08",
        note: "",
      });
      await filePhotos({
        experiment: experiment.id,
        observation: observation.id,
        photos: [
          { dish: dishes.get("S1")!, digest: digest!, filename: "S1.jpg" },
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

  test("an experiment photo is a garbage-collection root", async () => {
    const version = await trainedVersion("exp-gc");
    const experiment = await createExperiment({
      name: "GC",
      inoculatedOn: INOCULATED,
      modelVersionId: version.id,
    });
    const dishes = await layOut(experiment.id, ["E1"]);
    const observation = await addObservation({
      experiment: experiment.id,
      observedOn: "2026-08-08",
      note: "",
    });
    await photograph(experiment.id, observation.id, dishes, { E1: "gc-e1" });
    const kept = await imageDigest("gc-e1");
    const [loose] = await storeTexts(["gc-loose"]);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const collected = await collectImages(later);

    expect(collected).toContain(loose!);
    expect(collected).not.toContain(kept);
    expect(await blobExists(imageBlobKey(kept))).toBeTrue();
  });
});
