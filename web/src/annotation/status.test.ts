import { expect, test } from "bun:test";

import type { AnnotationDocument } from "./schema";
import { editReview, finishReview, reviewState } from "./status";

const stored: AnnotationDocument = {
  schemaVersion: 1,
  image: { digest: "0".repeat(64), width: 100, height: 100 },
  status: "complete",
  revision: 3,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

test("a review nobody has stored reads as unreviewed", () => {
  expect(reviewState(null)).toBe("unreviewed");
  expect(reviewState({ ...stored, revision: 0 })).toBe("unreviewed");
  expect(reviewState(stored)).toBe("complete");
});

test("changing the boxes reopens the review and finishing completes it", () => {
  const edited = editReview(stored, []);
  expect(edited.status).toBe("in_progress");
  expect(edited.instances).toEqual([]);
  expect(finishReview(edited).status).toBe("complete");
});
