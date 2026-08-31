import { describe, expect, test } from "bun:test";

import {
  formatReading,
  read,
  readingSchema,
  summarize,
  tally,
  type Reading,
} from "./readings";

const seeds: Reading = {
  id: "seeds",
  name: "Seeds",
  kind: "count",
  classes: ["seed", "germinated"],
};
const rate: Reading = {
  id: "rate",
  name: "Germination rate",
  kind: "proportion",
  of: ["germinated"],
  among: ["seed", "germinated"],
};

describe("readings", () => {
  test("count sums the declared classes and ignores the rest", () => {
    const counts = tally([
      { class: "seed" },
      { class: "seed" },
      { class: "germinated" },
      { class: "debris" },
    ]);
    expect(counts).toEqual({ seed: 2, germinated: 1, debris: 1 });
    expect(read(seeds, counts)).toBe(3);
    expect(formatReading(seeds, 3)).toBe("3");
  });

  test("proportion divides within the declared population", () => {
    expect(read(rate, { seed: 3, germinated: 1 })).toBe(0.25);
    expect(formatReading(rate, 0.25)).toBe("25.0%");
    expect(read(rate, {})).toBeNull();
    expect(formatReading(rate, null)).toBe("—");
  });

  test("identifiers are lower snake case", () => {
    expect(
      readingSchema.safeParse({ ...seeds, id: "Seed Count" }).success,
    ).toBeFalse();
    expect(readingSchema.safeParse({ ...rate, among: [] }).success).toBeFalse();
  });

  test("class sets are unique and a proportion is part of its population", () => {
    expect(
      readingSchema.safeParse({ ...seeds, classes: ["seed", "seed"] }).success,
    ).toBeFalse();
    expect(
      readingSchema.safeParse({ ...rate, of: ["germinated", "germinated"] })
        .success,
    ).toBeFalse();
    expect(
      readingSchema.safeParse({
        ...rate,
        of: ["germinated"],
        among: ["seed"],
      }).success,
    ).toBeFalse();
  });

  test("summaries carry the mean, the spread, and the contributing dishes", () => {
    expect(summarize(seeds, [{ seed: 2 }, {}, { seed: 4 }])).toEqual({
      value: 2,
      deviation: 2,
      sampleSize: 3,
    });
    expect(summarize(rate, [{}, { seed: 3, germinated: 1 }])).toEqual({
      value: 0.25,
      deviation: null,
      sampleSize: 1,
    });
    expect(summarize(seeds, [])).toEqual({
      value: null,
      deviation: null,
      sampleSize: 0,
    });
  });
});
