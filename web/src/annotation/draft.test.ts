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

test("submission preserves one snapshot across queued replacements, undo and redo", () => {
  const initial = opened([], null);
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
  const initial = opened([box], [box]);
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

test("an untouched draft takes the stored instances once they are read", () => {
  const draft = reduceDraft(openDraft([box]), { type: "base", base: [other] });
  expect(draft.ready).toBe(true);
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([other]);
});

test("replacements made before the stored instances arrive are kept", () => {
  const started = openDraft([box]);
  const replaced = reduceDraft(started, { type: "replace", instances: [] });
  const draft = reduceDraft(replaced, { type: "base", base: [other] });
  expect(draft.base).toEqual([other]);
  expect(draft.instances).toEqual([]);
});

test("reading the same instances keeps the opening array", () => {
  const opening = [box];
  const draft = reduceDraft(openDraft(opening), { type: "base", base: [box] });
  expect(draft.instances).toBe(opening);
});

test("submit does nothing until the stored annotation has been read", () => {
  const started = openDraft([box]);
  expect(reduceDraft(started, { type: "submit" })).toBe(started);
});
