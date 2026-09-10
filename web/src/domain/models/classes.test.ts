import { describe, expect, test } from "bun:test";

import { assertInstanceClasses, count, tally } from "./classes";

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
