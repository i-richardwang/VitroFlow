import { expect, test } from "bun:test";

import { openDraft, reduceDraft, type DraftAction } from "./draft";
import type { AnnotationInstance } from "./schema";

const box: AnnotationInstance = {
  id: "one",
  class: "seed",
  bbox: { x: 0, y: 0, width: 2, height: 3 },
};

const other: AnnotationInstance = {
  id: "two",
  class: "seed",
  bbox: { x: 1, y: 1, width: 2, height: 3 },
};

test("submission preserves one snapshot across queued replacements, undo and redo", () => {
  const initial = openDraft(null, []);
  const replaced = reduceDraft(initial, { type: "replace", instances: [box] });
  const saving = reduceDraft(replaced, { type: "submit" });
  for (const action of [
    { type: "replace", instances: [] },
    { type: "undo" },
    { type: "redo" },
    { type: "submit" },
  ] satisfies DraftAction[]) {
    expect(reduceDraft(saving, action)).toBe(saving);
  }
  expect(saving.base).toBeNull();
  expect(saving.instances).toEqual([box]);
  const retry = reduceDraft(saving, { type: "failed" });
  expect(retry.instances).toEqual([box]);
  expect(reduceDraft(retry, { type: "undo" }).instances).toEqual([]);
});

test("undo and redo change the draft without changing its save base", () => {
  const initial = openDraft([box], [box]);
  const replaced = reduceDraft(initial, { type: "replace", instances: [] });
  const undone = reduceDraft(replaced, { type: "undo" });
  expect(undone.instances).toEqual([box]);
  expect(undone.past).toEqual([]);
  expect(reduceDraft(undone, { type: "redo" }).instances).toEqual([]);
  expect(replaced.base).toEqual([box]);
  expect(
    reduceDraft(initial, { type: "replace", instances: [{ ...box }] }),
  ).toBe(initial);
});

test("the fetched annotation is both the edit origin and the save base", () => {
  const draft = openDraft([other], [box]);
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([other]);
  expect(draft.past).toEqual([]);
  expect(draft.future).toEqual([]);
});

test("a first review starts from detections, while an empty saved review stays empty", () => {
  expect(openDraft(null, [box]).instances).toEqual([box]);
  expect(openDraft([], [box]).instances).toEqual([]);
});
