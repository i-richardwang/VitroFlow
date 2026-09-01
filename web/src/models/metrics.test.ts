import { describe, expect, test } from "bun:test";

import {
  formatMetric,
  computeMetric,
  derivedMetricSchema,
  summarizeMetric,
  tally,
  type DerivedMetric,
} from "./metrics";

const seeds: DerivedMetric = {
  id: "seeds",
  name: "Seeds",
  kind: "count",
  classes: ["seed", "germinated"],
};
const rate: DerivedMetric = {
  id: "rate",
  name: "Germination rate",
  kind: "proportion",
  of: ["germinated"],
  among: ["seed", "germinated"],
};

describe("metrics", () => {
  test("count sums the declared classes and ignores the rest", () => {
    const counts = tally([
      { class: "seed" },
      { class: "seed" },
      { class: "germinated" },
      { class: "debris" },
    ]);
    expect(counts).toEqual({ seed: 2, germinated: 1, debris: 1 });
    expect(computeMetric(seeds, counts)).toBe(3);
    expect(formatMetric(seeds, 3)).toBe("3");
  });

  test("proportion divides within the declared population", () => {
    expect(computeMetric(rate, { seed: 3, germinated: 1 })).toBe(0.25);
    expect(formatMetric(rate, 0.25)).toBe("25.0%");
    expect(computeMetric(rate, {})).toBeNull();
    expect(formatMetric(rate, null)).toBe("—");
  });

  test("identifiers are lower snake case", () => {
    expect(
      derivedMetricSchema.safeParse({ ...seeds, id: "Seed Count" }).success,
    ).toBeFalse();
    expect(
      derivedMetricSchema.safeParse({ ...rate, among: [] }).success,
    ).toBeFalse();
  });

  test("class sets are unique and a proportion is part of its population", () => {
    expect(
      derivedMetricSchema.safeParse({ ...seeds, classes: ["seed", "seed"] })
        .success,
    ).toBeFalse();
    expect(
      derivedMetricSchema.safeParse({
        ...rate,
        of: ["germinated", "germinated"],
      }).success,
    ).toBeFalse();
    expect(
      derivedMetricSchema.safeParse({
        ...rate,
        of: ["germinated"],
        among: ["seed"],
      }).success,
    ).toBeFalse();
  });

  test("summaries carry the mean, spread, and contributing observation units", () => {
    expect(summarizeMetric(seeds, [{ seed: 2 }, {}, { seed: 4 }])).toEqual({
      value: 2,
      deviation: 2,
      sampleSize: 3,
    });
    expect(summarizeMetric(rate, [{}, { seed: 3, germinated: 1 }])).toEqual({
      value: 0.25,
      deviation: null,
      sampleSize: 1,
    });
    expect(summarizeMetric(seeds, [])).toEqual({
      value: null,
      deviation: null,
      sampleSize: 0,
    });
  });
});
