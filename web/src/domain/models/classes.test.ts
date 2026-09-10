import { describe, expect, test } from "bun:test";

import {
  assertInstanceClasses,
  classCount,
  count,
  tally,
  tallySchema,
} from "./classes";

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

  test("counts a class named for something every object carries", () => {
    const counts = tally([{ class: "constructor" }, { class: "constructor" }]);
    expect(counts).toEqual({ constructor: 2 });
    expect(classCount(counts, "constructor")).toBe(2);
    expect(count(counts)).toBe(2);
  });

  test("a class absent from a tally was counted zero times", () => {
    expect(classCount(tallySchema.parse({ seed: 3 }), "constructor")).toBe(0);
    expect(classCount(tallySchema.parse({ seed: 3 }), "germinated")).toBe(0);
  });

  test("rejects instances outside the model's task", () => {
    expect(() =>
      assertInstanceClasses(["seed"], [{ class: "mould" }], "Annotation"),
    ).toThrow(/unknown class: mould/);
  });
});
