import { describe, expect, test } from "bun:test";

import { initialBoxSide, instancesFromDetection } from "./detection";
import { makeResult } from "./testing";

describe("initialBoxSide", () => {
  const image = { width: 4000, height: 3000 };

  test("uses the median size of the boxes on the image", () => {
    const boxes = [
      { bbox: { x: 0, y: 0, width: 40, height: 40 } },
      { bbox: { x: 0, y: 0, width: 50, height: 50 } },
      { bbox: { x: 0, y: 0, width: 90, height: 90 } },
    ];
    expect(initialBoxSide(boxes, image)).toBe(50);
  });

  test("falls back to image size when the image has no boxes", () => {
    expect(initialBoxSide([], image)).toBe(37.5);
  });
});

describe("instancesFromDetection", () => {
  test("keeps every box the detection found", () => {
    const result = makeResult([
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 300, y: 200 },
    ]);
    expect(
      instancesFromDetection(result).map((instance) => instance.id),
    ).toEqual(["1", "2"]);
  });
});
