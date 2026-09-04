import { describe, expect, test } from "bun:test";

import { annotationSchema } from "./schema";
import { documentFromDetection, initialBoxSide } from "./detection";
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

describe("documentFromDetection", () => {
  test("copies the detection's boxes into a fresh review", () => {
    const result = makeResult([
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 300, y: 200 },
    ]);
    const document = documentFromDetection(result);
    expect(annotationSchema.safeParse(document).success).toBe(true);
    expect(document.status).toBe("in_progress");
    expect(document.revision).toBe(0);
    expect(document.instances.map((instance) => instance.id)).toEqual([
      "1",
      "2",
    ]);
  });
});
