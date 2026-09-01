import { describe, expect, test } from "bun:test";

import {
  replicateCodes,
  observationUnitOrder,
  suggestObservationUnit,
} from "./naming";

describe("observation unit naming", () => {
  test("codes a treatment's replicates in one series", () => {
    expect(replicateCodes("T1", 3, [])).toEqual(["T1-1", "T1-2", "T1-3"]);
  });

  test("continues the series past the codes already used", () => {
    expect(replicateCodes("T1", 2, ["T1-1", "t1_3"])).toEqual(["T1-2", "T1-4"]);
  });

  test("orders observation units by treatment, then by code", () => {
    const observationUnits = [
      { code: "B1", treatment: null },
      { code: "T1-10", treatment: "t1" },
      { code: "T1-2", treatment: "t1" },
      { code: "CK-1", treatment: "ck" },
    ];
    const treatments = [
      { id: "ck", position: 1 },
      { id: "t1", position: 2 },
    ];
    expect(
      observationUnitOrder(observationUnits, treatments).map(
        (observationUnit) => observationUnit.code,
      ),
    ).toEqual(["CK-1", "T1-2", "T1-10", "B1"]);
  });
});

describe("suggesting an observation unit from an image filename", () => {
  const codes = ["CK-1", "T1-1", "T1-2"];

  test("recognizes a code regardless of filename separator", () => {
    expect(suggestObservationUnit("T1-2.jpg", codes)).toBe("T1-2");
    expect(suggestObservationUnit(" t1_2.JPG ", codes)).toBe("T1-2");
    expect(suggestObservationUnit("IMG_0413_T1-2.jpg", codes)).toBe("T1-2");
  });

  test("leaves an unmatched filename to the operator", () => {
    expect(suggestObservationUnit("IMG_0413.jpg", codes)).toBeNull();
    expect(suggestObservationUnit(".jpg", codes)).toBeNull();
    expect(suggestObservationUnit("T1-9.jpg", codes)).toBeNull();
  });
});
