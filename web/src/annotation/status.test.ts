import { describe, expect, test } from "bun:test";

import type { AnnotationDocument } from "./schema";
import { ReviewTransitionError, transition } from "./status";

const base: AnnotationDocument = {
  image: { path: "a.jpg", width: 100, height: 100 },
  source: { runId: "r", modelFingerprint: "f" },
  status: "in_progress",
  revision: 3,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

describe("transition", () => {
  test("edit sends a completed image back to in_progress", () => {
    expect(
      transition({ ...base, status: "complete" }, { type: "edit" }).status,
    ).toBe("in_progress");
    expect(transition(base, { type: "edit" })).toBe(base);
    expect(
      transition({ ...base, status: "excluded" }, { type: "edit" }).status,
    ).toBe("excluded");
  });
  test("complete validates the document first", () => {
    expect(transition(base, { type: "complete" }).status).toBe("complete");
    const invalid = {
      ...base,
      instances: [
        {
          id: "one",
          class: "seed" as const,
          bbox: { x: 98, y: 1, width: 5, height: 5 },
        },
      ],
    };
    expect(() => transition(invalid, { type: "complete" })).toThrow(
      ReviewTransitionError,
    );
    expect(() =>
      transition({ ...base, status: "excluded" }, { type: "complete" }),
    ).toThrow(ReviewTransitionError);
  });
  test("reopen, exclude and include", () => {
    expect(
      transition({ ...base, status: "complete" }, { type: "reopen" }).status,
    ).toBe("in_progress");
    const excluded = transition(base, { type: "exclude", reason: "blurry" });
    expect(excluded.status).toBe("excluded");
    expect(excluded.excludedReason).toBe("blurry");
    const included = transition(excluded, { type: "include" });
    expect(included.status).toBe("in_progress");
    expect("excludedReason" in included).toBe(false);
    expect(() => transition(base, { type: "include" })).toThrow(
      ReviewTransitionError,
    );
  });
});
