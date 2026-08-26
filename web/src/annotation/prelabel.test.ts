import { describe, expect, test } from "bun:test";

import { annotationSchema } from "./schema";
import { documentFromPrelabel, initialBoxSide } from "./prelabel";
import { makeResult } from "./testing";

describe("initialBoxSide", () => {
  test("uses the median prelabel box size", () => {
    const result = makeResult(
      [
        { id: 1, x: 100, y: 100 },
        { id: 2, x: 300, y: 200 },
      ],
      2000,
    );
    expect(initialBoxSide(result)).toBe(50);
  });

  test("falls back to image size when a prelabel has no boxes", () => {
    expect(initialBoxSide(makeResult([]))).toBe(37.5);
  });
});

describe("documentFromPrelabel", () => {
  test("copies canonical boxes and records their producing version", () => {
    const result = makeResult([
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 300, y: 200 },
    ]);
    const document = documentFromPrelabel(result);
    expect(annotationSchema.safeParse(document).success).toBe(true);
    expect(document.status).toBe("in_progress");
    expect(document.revision).toBe(0);
    expect(document.source).toEqual({
      prelabelerVersionId: "traditional-v1",
      prelabelerFingerprint: "b".repeat(64),
    });
    expect(document.instances.map((instance) => instance.id)).toEqual([
      "1",
      "2",
    ]);
  });
});
