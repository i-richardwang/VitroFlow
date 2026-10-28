import { describe, expect, test } from "bun:test";

import {
  assertInstanceClasses,
  classCount,
  countClasses,
  sameClasses,
  tally,
  tallySchema,
} from "./classes";

describe("tallies", () => {
  test("counts the instances of each class", () => {
    expect(
      tally([{ class: "seed" }, { class: "germinated" }, { class: "seed" }]),
    ).toEqual({ seed: 2, germinated: 1 });
  });

  test("counts the named classes a reading found, together", () => {
    const counts = { seed: 5, germinated: 15 };
    expect(countClasses(counts, ["seed", "germinated"])).toBe(20);
    expect(countClasses(counts, ["germinated"])).toBe(15);
  });

  test("counts nothing as nothing", () => {
    expect(countClasses({}, ["seed"])).toBe(0);
  });

  test("counts a class named for something every object carries", () => {
    const counts = tally([{ class: "constructor" }, { class: "constructor" }]);
    expect(counts).toEqual({ constructor: 2 });
    expect(classCount(counts, "constructor")).toBe(2);
    expect(countClasses(counts, ["constructor"])).toBe(2);
  });

  test("a class absent from a tally was counted zero times", () => {
    expect(classCount(tallySchema.parse({ seed: 3 }), "constructor")).toBe(0);
    expect(classCount(tallySchema.parse({ seed: 3 }), "germinated")).toBe(0);
  });

  test("class lists match name for name, in order", () => {
    expect(sameClasses(["seed", "germinated"], ["seed", "germinated"])).toBe(
      true,
    );
    expect(sameClasses(["seed", "germinated"], ["germinated", "seed"])).toBe(
      false,
    );
    expect(sameClasses(["seed"], ["seed", "germinated"])).toBe(false);
  });

  test("rejects instances outside the model's task", () => {
    expect(() =>
      assertInstanceClasses(["seed"], [{ class: "mould" }], "Annotation"),
    ).toThrow(/unknown class: mould/);
  });
});
