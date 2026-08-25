import { describe, expect, test } from "bun:test";

import { annotationSchema } from "./schema";
import {
  documentFromResult,
  initialBoxFromDetection,
  initialBoxSide,
} from "./prelabel";
import { makeResult } from "./testing";

describe("initialBoxFromDetection", () => {
  test("centers a square whose side follows the dish radius", () => {
    const side = initialBoxSide(2000);
    expect(side).toBe(50);
    expect(
      initialBoxFromDetection({ x: 500, y: 400 }, 2000, {
        width: 4000,
        height: 3000,
      }),
    ).toEqual({
      x: 475,
      y: 375,
      width: side,
      height: side,
    });
  });
  test("clips boxes near the border", () => {
    const box = initialBoxFromDetection({ x: 10, y: 10 }, 2000, {
      width: 4000,
      height: 3000,
    });
    expect(box).toEqual({ x: 0, y: 0, width: 35, height: 35 });
  });
});

describe("documentFromResult", () => {
  test("produces a valid in-progress document with one instance per detection", () => {
    const result = makeResult([
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 300, y: 200 },
    ]);
    const document = documentFromResult(result, "run-a");
    expect(annotationSchema.safeParse(document).success).toBe(true);
    expect(document.status).toBe("in_progress");
    expect(document.revision).toBe(0);
    expect(document.source).toEqual({
      runId: "run-a",
      pipelineFingerprint: "a".repeat(64),
      modelFingerprint: "b".repeat(64),
    });
    expect(document.instances).toHaveLength(2);
    expect(
      new Set(document.instances.map((instance) => instance.id)).size,
    ).toBe(2);
  });
});
