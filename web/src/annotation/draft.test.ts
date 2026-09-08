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

function opened(
  opening: AnnotationInstance[],
  base: AnnotationInstance[] | null,
): ReturnType<typeof openDraft> {
  return reduceDraft(openDraft(opening), { type: "base", base });
}

test("submission preserves one snapshot across queued edits, undo and redo", () => {
  const initial = opened([], null);
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
  const initial = opened([box], [box]);
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

test("an unedited session takes the stored boxes once they are read", () => {
  const draft = reduceDraft(openDraft([box]), { type: "base", base: [other] });
  expect(draft.ready).toBe(true);
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([other]);
});

test("edits made before the stored boxes arrive are kept", () => {
  const started = openDraft([box]);
  const edited = reduceDraft(started, { type: "edit", instances: [] });
  const draft = reduceDraft(edited, { type: "base", base: [other] });
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([]);
});

test("reading the same boxes keeps the opening instances", () => {
  const opening = [box];
  const draft = reduceDraft(openDraft(opening), { type: "base", base: [box] });
  expect(draft.instances).toBe(opening);
});

test("submit does nothing until the stored annotation has been read", () => {
  const started = openDraft([box]);
  expect(reduceDraft(started, { type: "submit" })).toBe(started);
});
