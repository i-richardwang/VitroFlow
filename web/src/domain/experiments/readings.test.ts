import { describe, expect, test } from "bun:test";

import type { ObservationImageCell } from "./contracts";
import type { ExperimentObservation } from "./schema";
import { observationCells, unitReading } from "./readings";

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

function observation(ordinal: number): ExperimentObservation {
  return {
    id: `observation-${ordinal}`,
    ordinal,
    observedOn: "2026-09-01",
    day: ordinal - 1,
    note: "",
    modelId: "seed-detector",
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

  test("a cell counts every class its reading found", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 12, germinated: 8 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual(unreviewed(20));
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
