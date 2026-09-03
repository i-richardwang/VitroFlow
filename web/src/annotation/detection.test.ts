import { describe, expect, test } from "bun:test";

import { annotationSchema } from "./schema";
import { documentFromDetection, initialBoxSide } from "./detection";
import { makeResult } from "./testing";

describe("initialBoxSide", () => {
  test("uses the median detection box size", () => {
    const result = makeResult(
      [
        { id: 1, x: 100, y: 100 },
        { id: 2, x: 300, y: 200 },
      ],
      { dishRadius: 2000 },
    );
    expect(initialBoxSide(result)).toBe(50);
  });

  test("falls back to image size when a detection has no boxes", () => {
    expect(initialBoxSide(makeResult([]))).toBe(37.5);
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
