import { describe, expect, test } from "bun:test";

import { replicateCodes, unitOrder, suggestUnit } from "./naming";

describe("unit naming", () => {
  test("codes a treatment's replicates in one series", () => {
    expect(replicateCodes("T1", 3, [])).toEqual(["T1-1", "T1-2", "T1-3"]);
  });

  test("continues the series past the codes already used", () => {
    expect(replicateCodes("T1", 2, ["T1-1", "t1-3"])).toEqual(["T1-2", "T1-4"]);
  });

  test("orders units by treatment, then by code", () => {
    const units = [
      { code: "T1-10", treatment: "t1" },
      { code: "T1-2", treatment: "t1" },
      { code: "CK-1", treatment: "ck" },
    ];
    const treatments = [
      { id: "ck", position: 1 },
      { id: "t1", position: 2 },
    ];
    expect(unitOrder(units, treatments).map((unit) => unit.code)).toEqual([
      "CK-1",
      "T1-2",
      "T1-10",
    ]);
  });
});

describe("suggesting a unit from an image filename", () => {
  const codes = ["CK-1", "T1-1", "T1-2"];

  test("recognizes a code regardless of filename separator", () => {
    expect(suggestUnit("T1-2.jpg", codes)).toBe("T1-2");
    expect(suggestUnit(" t1_2.JPG ", codes)).toBe("T1-2");
    expect(suggestUnit("IMG_0413_T1-2.jpg", codes)).toBe("T1-2");
  });

  test("leaves an unmatched filename to the operator", () => {
    expect(suggestUnit("IMG_0413.jpg", codes)).toBeNull();
    expect(suggestUnit(".jpg", codes)).toBeNull();
    expect(suggestUnit("T1-9.jpg", codes)).toBeNull();
  });
});
