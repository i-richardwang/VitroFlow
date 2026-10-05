import { describe, expect, test } from "bun:test";

import type { ObservationImageCell, Unit } from "./contracts";
import { observationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";
import {
  cellTally,
  observationCells,
  summarize,
  treatmentSummary,
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
  detected: null,
});

describe("the tally a cell reads by", () => {
  test("a reviewed annotation replaces the detection under it", () => {
    expect(
      cellTally(
        cell("a", "b", {
          detectionTally: { ungerminated: 19 },
          annotationTally: { ungerminated: 20 },
        }),
      ),
    ).toEqual({ ungerminated: 20 });
  });

  test("an unreviewed image reads by its detection", () => {
    expect(
      cellTally(cell("a", "b", { detectionTally: { ungerminated: 19 } })),
    ).toEqual({ ungerminated: 19 });
  });

  test("an image with no reading has no tally", () => {
    expect(cellTally(cell("a", "b"))).toBeNull();
    expect(cellTally(undefined)).toBeNull();
  });
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

  test("a reviewed cell carries the detection it replaced", () => {
    const cells = observationCells([
      cell("dish", day0.id, {
        detectionTally: { ungerminated: 19 },
        annotationTally: { ungerminated: 20 },
      }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 20,
      source: "review",
      detected: 19,
    });
  });

  test("an annotation drawn where nothing was detected replaced nothing", () => {
    const cells = observationCells([
      cell("dish", day0.id, { annotationTally: { ungerminated: 20 } }),
    ]);
    expect(unitReading(cells, "dish", day0)).toEqual({
      count: 20,
      source: "review",
      detected: null,
    });
  });

  test("a cell with no image reads nothing", () => {
    const cells = observationCells([]);
    expect(unitReading(cells, "dish", day0)).toBeNull();
  });
});

describe("summaries", () => {
  test("averages the replicates and spreads them", () => {
    const summary = summarize([18, 20, 22]);
    expect(summary.value).toBe(20);
    expect(summary.deviation).toBe(2);
    expect(summary.sampleSize).toBe(3);
  });

  test("a single replicate has no spread", () => {
    expect(summarize([20])).toEqual({
      value: 20,
      deviation: null,
      sampleSize: 1,
    });
  });

  test("nothing observed summarizes to nothing", () => {
    expect(summarize([])).toEqual({
      value: null,
      deviation: null,
      sampleSize: 0,
    });
  });
});

describe("what a treatment read on a day", () => {
  const sown = observation(1);
  const later = observation(2);
  const ordinals = observationOrdinals([sown, later]);

  function treatment(cells: ObservationImageCell[], units: Unit[]) {
    return (day: ExperimentObservation) =>
      treatmentSummary(observationCells(cells), units, day, ordinals);
  }

  /** Two dishes in which fifteen and ten seeds germinated. */
  const germinated = [
    cell("A1", later.id, { detectionTally: { germinated: 15 } }),
    cell("A2", later.id, { detectionTally: { germinated: 10 } }),
  ];

  function unit(id: string, events: Unit["events"] = []): Unit {
    return { id, code: id, treatment: "control", events };
  }

  function contaminatedAt(day: ExperimentObservation): Unit["events"] {
    return [
      {
        id: `${day.id}-contamination`,
        type: "contaminated",
        observation: day.id,
        recordedAt: "2026-09-15T00:00:00.000Z",
      },
    ];
  }

  test("means the counts of its replicates", () => {
    const summary = treatment(germinated, [unit("A1"), unit("A2")])(later);
    expect(summary.value).toBe(12.5);
    expect(summary.sampleSize).toBe(2);
  });

  test("a replicate an event excluded is left out, and uncounted", () => {
    const summary = treatment(germinated, [
      unit("A1"),
      unit("A2", contaminatedAt(later)),
    ])(later);
    expect(summary.value).toBe(15);
    expect(summary.sampleSize).toBe(1);
  });

  test("a day nothing has read yet means nothing, over nobody", () => {
    const summary = treatment(germinated, [unit("A1"), unit("A2")])(sown);
    expect(summary.value).toBeNull();
    expect(summary.sampleSize).toBe(0);
  });
});
