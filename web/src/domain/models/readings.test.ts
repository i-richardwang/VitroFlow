import { describe, expect, test } from "bun:test";

import {
  assertInstanceClasses,
  count,
  formatCount,
  formatCountSummary,
  formatRate,
  formatRateSummary,
  rate,
  summarize,
  tally,
} from "./readings";

describe("tallies", () => {
  test("counts the instances of each class", () => {
    expect(
      tally([{ class: "seed" }, { class: "germinated" }, { class: "seed" }]),
    ).toEqual({ seed: 2, germinated: 1 });
  });

  test("counts every class a reading found", () => {
    expect(count({ seed: 5, germinated: 15 })).toBe(20);
  });

  test("counts nothing as nothing", () => {
    expect(count({})).toBe(0);
  });

  test("rejects instances outside the model's task", () => {
    expect(() =>
      assertInstanceClasses(["seed"], [{ class: "mould" }], "Annotation"),
    ).toThrow(/unknown class: mould/);
  });
});

describe("rates", () => {
  test("divides what was found by the starting population", () => {
    expect(rate(15, 20)).toBe(0.75);
  });

  test("has no value without a baseline", () => {
    expect(rate(15, null)).toBeNull();
  });

  test("has no value when the baseline found nothing", () => {
    expect(rate(0, 0)).toBeNull();
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

describe("formatting", () => {
  test("counts read as whole numbers, averages to one decimal", () => {
    expect(formatCount(20)).toBe("20");
    expect(formatCount(19.5)).toBe("19.5");
    expect(formatCount(null)).toBe("—");
  });

  test("rates read as percentages", () => {
    expect(formatRate(0.75)).toBe("75.0%");
    expect(formatRate(null)).toBe("—");
  });

  test("a summary carries its spread and its sample size", () => {
    expect(formatCountSummary(summarize([18, 20, 22]))).toBe("20 ± 2 (n = 3)");
    expect(formatRateSummary(summarize([0.5, 1]))).toBe(
      "75.0% ± 35.4% (n = 2)",
    );
  });

  test("a summary of nothing reads as nothing", () => {
    expect(formatCountSummary(summarize([]))).toBe("—");
  });
});
