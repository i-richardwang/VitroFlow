import { describe, expect, test } from "bun:test";

import type { ObservationImageCell, Unit } from "./contracts";
import { observationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";
import {
  observationCells,
  summarize,
  treatmentSummary,
  treatmentTrend,
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

describe("how the treatments compare over time", () => {
  const first = observation(1);
  const second = observation(2);
  const recount = { ...observation(3), modelId: "seedling-detector" };
  const treatments = ["control", "auxin"].map((id, index) => ({
    id,
    name: id,
    factor: null,
    note: "",
    position: index + 1,
  }));
  const units: Unit[] = [
    { id: "C1", code: "C1", treatment: "control", events: [] },
    { id: "X1", code: "X1", treatment: "auxin", events: [] },
  ];

  test("follows every treatment over the days that read", () => {
    const trend = treatmentTrend({
      treatments,
      units,
      observations: [first, second],
      images: [
        cell("C1", first.id, { detectionTally: { germinated: 2 } }),
        cell("C1", second.id, { detectionTally: { germinated: 4 } }),
        cell("X1", second.id, { detectionTally: { germinated: 9 } }),
      ],
    });
    expect(
      trend.map((day) => [
        day.observation.id,
        day.treatments.map(({ treatment, summary }) => [
          treatment,
          summary.value,
        ]),
      ]),
    ).toEqual([
      [
        first.id,
        [
          ["control", 2],
          ["auxin", null],
        ],
      ],
      [
        second.id,
        [
          ["control", 4],
          ["auxin", 9],
        ],
      ],
    ]);
  });

  test("keeps to the model the newest reading day reads for", () => {
    const trend = treatmentTrend({
      treatments,
      units,
      observations: [first, second, recount],
      images: [
        cell("C1", first.id, { detectionTally: { germinated: 2 } }),
        cell("C1", recount.id, { detectionTally: { seedling: 1 } }),
      ],
    });
    expect(trend.map((day) => day.observation.id)).toEqual([recount.id]);
  });

  test("is empty until a day reads", () => {
    expect(
      treatmentTrend({
        treatments,
        units,
        observations: [first],
        images: [cell("C1", first.id, { state: "pending" })],
      }),
    ).toEqual([]);
  });
});
