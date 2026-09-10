import { describe, expect, test } from "bun:test";

import type { ObservationImageCell, Unit } from "./contracts";
import { observationOrdinals } from "./culture-events";
import type { ExperimentObservation } from "./schema";
import {
  baselineObservation,
  cellKey,
  cellTally,
  experimentReadings,
  summarize,
  treatmentSummary,
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

function grid(cells: ObservationImageCell[]) {
  return new Map(
    cells.map((item) => [cellKey(item.unit, item.observation), item]),
  );
}

/** What a reading looks like when nobody has reviewed the detection behind it. */
const unreviewed = (count: number) => ({
  count,
  rate: null,
  calibrated: false,
  detected: null,
});

describe("the tally a cell reads by", () => {
  test("a calibrated annotation replaces the detection under it", () => {
    expect(
      cellTally(
        cell("a", "b", {
          detectionTally: { seed: 19 },
          annotationTally: { seed: 20 },
        }),
      ),
    ).toEqual({ seed: 20 });
  });

  test("an unreviewed image reads by its detection", () => {
    expect(cellTally(cell("a", "b", { detectionTally: { seed: 19 } }))).toEqual(
      {
        seed: 19,
      },
    );
  });

  test("an image with no reading has no tally", () => {
    expect(cellTally(cell("a", "b"))).toBeNull();
    expect(cellTally(undefined)).toBeNull();
  });
});

describe("the baseline", () => {
  test("is the earliest observation, whatever order they arrive in", () => {
    expect(
      baselineObservation([observation(3), observation(1), observation(2)])?.id,
    ).toBe("observation-1");
  });

  test("an experiment with no observation has none", () => {
    expect(baselineObservation([])).toBeUndefined();
  });
});

describe("what a grid reads", () => {
  const day0 = observation(1);
  const day14 = observation(2);

  test("a later day divides by the population the baseline counted", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([
        cell("dish", day0.id, { detectionTally: { seed: 20 } }),
        cell("dish", day14.id, { detectionTally: { germinated: 15 } }),
      ]),
    );
    expect(readings.population("dish")).toBe(20);
    expect(readings.read("dish", day14)).toEqual({
      ...unreviewed(15),
      rate: 0.75,
    });
  });

  test("the baseline reads counts alone, because its own share is one", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([cell("dish", day0.id, { detectionTally: { seed: 20 } })]),
    );
    expect(readings.read("dish", day0)).toEqual(unreviewed(20));
  });

  test("the calibrated baseline is the one that counts", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([
        cell("dish", day0.id, {
          detectionTally: { seed: 19 },
          annotationTally: { seed: 20 },
        }),
        cell("dish", day14.id, { detectionTally: { germinated: 15 } }),
      ]),
    );
    expect(readings.read("dish", day14)).toEqual({
      ...unreviewed(15),
      rate: 0.75,
    });
  });

  test("a calibrated cell carries the detection it replaced", () => {
    const readings = experimentReadings(
      [day0],
      grid([
        cell("dish", day0.id, {
          detectionTally: { seed: 19 },
          annotationTally: { seed: 20 },
        }),
      ]),
    );
    expect(readings.read("dish", day0)).toEqual({
      count: 20,
      rate: null,
      calibrated: true,
      detected: 19,
    });
  });

  test("an annotation drawn where nothing was detected replaced nothing", () => {
    const readings = experimentReadings(
      [day0],
      grid([cell("dish", day0.id, { annotationTally: { seed: 20 } })]),
    );
    expect(readings.read("dish", day0)).toEqual({
      count: 20,
      rate: null,
      calibrated: true,
      detected: null,
    });
  });

  test("a baseline that found nothing leaves later days without a share", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([
        cell("dish", day0.id, { detectionTally: {} }),
        cell("dish", day14.id, { detectionTally: { germinated: 15 } }),
      ]),
    );
    expect(readings.population("dish")).toBe(0);
    expect(readings.read("dish", day14)).toEqual(unreviewed(15));
  });

  test("a unit never photographed at the baseline reads counts without a share", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([cell("dish", day14.id, { detectionTally: { germinated: 15 } })]),
    );
    expect(readings.population("dish")).toBeNull();
    expect(readings.read("dish", day14)).toEqual(unreviewed(15));
  });

  test("no unit borrows another unit's population", () => {
    const readings = experimentReadings(
      [day0, day14],
      grid([
        cell("counted", day0.id, { detectionTally: { seed: 20 } }),
        cell("late", day14.id, { detectionTally: { germinated: 15 } }),
      ]),
    );
    expect(readings.read("late", day14)).toEqual(unreviewed(15));
  });

  test("a cell with no image reads nothing", () => {
    const readings = experimentReadings([day0, day14], grid([]));
    expect(readings.read("dish", day14)).toBeNull();
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
      treatmentSummary(
        experimentReadings([sown, later], grid(cells)),
        units,
        day,
        ordinals,
      );
  }

  /** Two dishes sown with twenty seeds, of which fifteen and ten germinated. */
  const sownAndGerminated = [
    cell("A1", sown.id, { detectionTally: { seed: 20 } }),
    cell("A2", sown.id, { detectionTally: { seed: 20 } }),
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

  test("means the counts, and the shares behind them", () => {
    const summary = treatment(sownAndGerminated, [unit("A1"), unit("A2")])(
      later,
    );
    expect(summary.count.value).toBe(12.5);
    expect(summary.count.sampleSize).toBe(2);
    expect(summary.rate?.value).toBe(0.625);
  });

  test("the day that establishes the population means counts alone", () => {
    const summary = treatment(sownAndGerminated, [unit("A1"), unit("A2")])(
      sown,
    );
    expect(summary.count.value).toBe(20);
    expect(summary.rate).toBeNull();
  });

  test("a replicate an event excluded is left out, and uncounted", () => {
    const summary = treatment(sownAndGerminated, [
      unit("A1"),
      unit("A2", contaminatedAt(later)),
    ])(later);
    expect(summary.count.value).toBe(15);
    expect(summary.count.sampleSize).toBe(1);
    expect(summary.rate?.value).toBe(0.75);
  });

  test("one replicate without a share leaves the treatment without one", () => {
    const summary = treatment(
      [
        ...sownAndGerminated,
        cell("A3", later.id, { detectionTally: { germinated: 8 } }),
      ],
      [unit("A1"), unit("A2"), unit("A3")],
    )(later);
    expect(summary.count.value).toBe(11);
    expect(summary.count.sampleSize).toBe(3);
    expect(summary.rate).toBeNull();
  });

  test("a day nothing has read yet means nothing, over nobody", () => {
    const summary = treatment(
      [
        cell("A1", sown.id, { detectionTally: { seed: 20 } }),
        cell("A2", sown.id, { detectionTally: { seed: 20 } }),
      ],
      [unit("A1"), unit("A2")],
    )(later);
    expect(summary.count.value).toBeNull();
    expect(summary.count.sampleSize).toBe(0);
    expect(summary.rate).toBeNull();
  });
});
