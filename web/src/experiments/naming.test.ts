import { describe, expect, test } from "bun:test";

import { replicateLabels, rosterOrder, suggestDish } from "./naming";

describe("laying out dishes", () => {
  test("labels a treatment's replicates in one series", () => {
    expect(replicateLabels("T1", 3, [])).toEqual(["T1-1", "T1-2", "T1-3"]);
  });

  test("continues the series past the labels already used", () => {
    expect(replicateLabels("T1", 2, ["T1-1", "t1_3"])).toEqual([
      "T1-2",
      "T1-4",
    ]);
  });

  test("orders the roster by treatment, then by label", () => {
    const dishes = [
      { label: "B1", treatment: null },
      { label: "T1-10", treatment: "t1" },
      { label: "T1-2", treatment: "t1" },
      { label: "CK-1", treatment: "ck" },
    ];
    const treatments = [
      { id: "ck", position: 1 },
      { id: "t1", position: 2 },
    ];
    expect(rosterOrder(dishes, treatments).map((dish) => dish.label)).toEqual([
      "CK-1",
      "T1-2",
      "T1-10",
      "B1",
    ]);
  });
});

describe("guessing which dish a photograph shows", () => {
  const roster = ["CK-1", "T1-1", "T1-2"];

  test("reads a filename that spells a dish, whatever the separator", () => {
    expect(suggestDish("T1-2.jpg", roster)).toBe("T1-2");
    expect(suggestDish(" t1_2.JPG ", roster)).toBe("T1-2");
    expect(suggestDish("IMG_0413_T1-2.jpg", roster)).toBe("T1-2");
  });

  test("leaves a filename that names no dish to the operator", () => {
    expect(suggestDish("IMG_0413.jpg", roster)).toBeNull();
    expect(suggestDish(".jpg", roster)).toBeNull();
    expect(suggestDish("T1-9.jpg", roster)).toBeNull();
  });
});
