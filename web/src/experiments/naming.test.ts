import { describe, expect, test } from "bun:test";

import { inferTreatments, treatmentOfDish } from "./naming";

describe("experiment dish naming", () => {
  test("infers ordered treatment groups and their replicate dishes", () => {
    expect(inferTreatments(["T1-1", "T1-2", "T2_1", "CK 1", "Extra"])).toEqual([
      { name: "CK", dishes: ["CK 1"] },
      { name: "T1", dishes: ["T1-1", "T1-2"] },
      { name: "T2", dishes: ["T2_1"] },
    ]);
  });

  test("requires at least two treatment names", () => {
    expect(inferTreatments(["T1-1", "T1-2", "Extra"])).toEqual([]);
    expect(inferTreatments(["A1", "A2", "Extra"])).toEqual([]);
  });

  test("uses the treatment schema for inferred names", () => {
    expect(treatmentOfDish(`${"x".repeat(121)}-1`)).toBeNull();
    expect(treatmentOfDish("T1-1")).toBe("T1");
    expect(treatmentOfDish(" T1-1")).toBe("T1");
  });
});
