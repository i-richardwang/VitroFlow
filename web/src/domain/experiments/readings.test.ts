import { describe, expect, test } from "bun:test";

import type { ObservationImageCell } from "./contracts";
import type { ExperimentObservation } from "./schema";
import { UnknownClassError } from "../models/errors";
import {
  observationCells,
  resolveCountedClasses,
  unitReading,
} from "./readings";

function cell(
  unit: string,
  observation: string,
  overrides: Partial<ObservationImageCell> = {},
): ObservationImageCell {
  return {
    id: `${unit}-${observation}`,
    unit,
    observation,
    digest: "a".repeat(64),
    filename: "IMG_0001.JPG",
    state: "analyzed",
    detectionTally: null,
    proposalTally: null,
    annotationTally: null,
    error: null,
    ...overrides,
  };
}

const SEED_CLASSES = ["ungerminated", "germinated"];

function observation(
  ordinal: number,
  counted: string[] = SEED_CLASSES,
): ExperimentObservation {
  return {
    id: `observation-${ordinal}`,
    ordinal,
    observedOn: "2026-09-01",
    note: "",
    modelId: "seed-detector",
    countedClasses: counted,
    hasRecords: false,
  };
}

/** What a reading looks like when nobody has reviewed the detection behind it. */
const unreviewed = (count: number) => ({
  count,
  source: "detection" as const,
});

describe("what a grid reads", () => {
  const day0 = observation(1);

  test("a day that names every class counts the whole tally", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 12, germinated: 8 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(20));
  });

  test("a later day counts only the classes it names", () => {
    const day7 = observation(2, ["germinated"]);
    const cells = observationCells([
      cell("dish", day7.id, {
        annotationTally: { ungerminated: 3, germinated: 15 },
      }),
    ]);
    expect(unitReading(cells, "dish", day7)).toEqual({
      count: 15,
      source: "review",
    });
  });

  test("a review replaces the AI's suggestion and the detection under it", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 19 },
        proposalTally: { ungerminated: 21 },
        annotationTally: { ungerminated: 20 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 20,
      source: "review",
    });
  });

  test("an AI suggestion reads before the detection", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 19 },
        proposalTally: { ungerminated: 21 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 21,
      source: "proposal",
    });
  });

  test("a photograph not yet counted, or none, reads nothing", () => {
    const cells = observationCells([cell("dish", day0.id)]);
    expect(unitReading(cells, "dish", day0)).toBeNull();
    expect(unitReading(cells, "other", day0)).toBeNull();
  });
});

describe("which classes a day counts", () => {
  test("every class its model recognizes, unless it names fewer", () => {
    expect(resolveCountedClasses(SEED_CLASSES, undefined)).toEqual(
      SEED_CLASSES,
    );
    expect(resolveCountedClasses(SEED_CLASSES, ["germinated"])).toEqual([
      "germinated",
    ]);
  });

  test("in the order its model declares them", () => {
    expect(
      resolveCountedClasses(SEED_CLASSES, ["germinated", "ungerminated"]),
    ).toEqual(SEED_CLASSES);
  });

  test("never a class its model does not recognize", () => {
    expect(() => resolveCountedClasses(SEED_CLASSES, ["shoot"])).toThrow(
      UnknownClassError,
    );
  });
});
