import { expect, test } from "bun:test";
import { openDraft, reduceDraft, type DraftAction } from "./draft";
import type { AnnotationInstance } from "./schema";

const box: AnnotationInstance = {
  id: "one",
  class: "seed",
  bbox: { x: 0, y: 0, width: 2, height: 3 },
};

test("submission preserves one snapshot across queued edits, undo and redo", () => {
  const initial = openDraft(null, []);
  const edited = reduceDraft(initial, { type: "edit", instances: [box] });
  const saving = reduceDraft(edited, { type: "submit" });
  for (const action of [
    { type: "edit", instances: [] },
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

test("undo and redo change the draft without changing its editing base", () => {
  const initial = openDraft([box], [box]);
  const edited = reduceDraft(initial, { type: "edit", instances: [] });
  const undone = reduceDraft(edited, { type: "undo" });
  expect(undone.instances).toEqual([box]);
  expect(undone.past).toEqual([]);
  expect(reduceDraft(undone, { type: "redo" }).instances).toEqual([]);
  expect(edited.base).toEqual([box]);
  expect(reduceDraft(initial, { type: "edit", instances: [{ ...box }] })).toBe(
    initial,
  );
});
