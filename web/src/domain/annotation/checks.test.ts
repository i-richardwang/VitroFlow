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
const area = { x: 80, y: 40, width: 20, height: 20 };
const proposal: AnnotationProposal = {
  createdAt: "2026-10-03T00:00:00.000Z",
  document: {
    schemaVersion: 1,
    image: { digest: "a".repeat(64), width: 100, height: 100 },
    instances: [sure, unsure],
  },
  uncertainIds: [unsure.id],
  issues: [{ bbox: area, reason: "Faint streak" }],
};

test("the proposal as drawn leaves every check open, in reading order", () => {
  expect(openChecks(proposal, [sure, unsure])).toEqual([
    { kind: "uncertain", id: "unsure", bbox: unsure.bbox },
    { kind: "issue", bbox: area, reason: "Faint streak" },
  ]);
});

test("touching a box closes its check; editing an area closes its issue", () => {
  const moved = { ...unsure, bbox: { ...unsure.bbox, x: 41 } };
  expect(openChecks(proposal, [sure, moved]).map((c) => c.kind)).toEqual([
    "issue",
  ]);
  expect(openChecks(proposal, [sure]).map((c) => c.kind)).toEqual(["issue"]);
  const added = {
    id: "added",
    class: "seed",
    bbox: { x: 85, y: 45, width: 10, height: 10 },
  };
  expect(openChecks(proposal, [sure, unsure, added])).toHaveLength(1);
  expect(
    openChecks(proposal, [{ ...sure, class: "other" }, unsure]),
  ).toHaveLength(2);
});
