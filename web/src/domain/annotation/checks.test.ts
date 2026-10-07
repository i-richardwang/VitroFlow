import { expect, test } from "bun:test";

import type { AnnotationProposal } from "../annotation-runs/schema";
import { openChecks } from "./checks";

const sure = {
  id: "sure",
  class: "seed",
  bbox: { x: 0, y: 0, width: 10, height: 10 },
};
const unsure = {
  id: "unsure",
  class: "seed",
  bbox: { x: 40, y: 0, width: 10, height: 10 },
};
const proposal: AnnotationProposal = {
  createdAt: "2026-10-03T00:00:00.000Z",
  document: {
    schemaVersion: 1,
    image: { digest: "a".repeat(64), width: 100, height: 100 },
    instances: [sure, unsure],
  },
  uncertainIds: [unsure.id],
};

test("the proposal as drawn asks to confirm its uncertain boxes", () => {
  expect(openChecks(proposal, [sure, unsure])).toEqual([unsure]);
});

test("moving, reclassifying or removing a box confirms it", () => {
  const moved = { ...unsure, bbox: { ...unsure.bbox, x: 41 } };
  expect(openChecks(proposal, [sure, moved])).toEqual([]);
  expect(openChecks(proposal, [sure, { ...unsure, class: "other" }])).toEqual(
    [],
  );
  expect(openChecks(proposal, [sure])).toEqual([]);
  expect(openChecks(proposal, [{ ...sure, class: "other" }, unsure])).toEqual([
    unsure,
  ]);
});
