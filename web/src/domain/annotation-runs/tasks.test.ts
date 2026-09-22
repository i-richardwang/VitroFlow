import { expect, test } from "bun:test";
import {
  regions,
  sourceBox,
  owns,
  validateProposal,
  seamWarnings,
} from "./tasks";
import type { AnnotationDefinition } from "./schema";
const definition: AnnotationDefinition = {
  input: null,
  image: { digest: "a".repeat(64), width: 120, height: 80 },
  config: {
    coreSize: 64,
    halo: 16,
    displayScale: 4,
    classes: ["seed"],
    rules: "Box seeds",
  },
};

test("regions preserve source coverage, clip halo and assign seam centers exactly once", () => {
  const tasks = regions(definition);
  expect(tasks).toHaveLength(4);
  expect(tasks[0]!.patch).toEqual({ x: 0, y: 0, width: 80, height: 80 });
  const box = { x: 60, y: 20, width: 8, height: 8 };
  expect(
    tasks.filter((task) => owns(task.core, box)).map((task) => task.id),
  ).toEqual(["tile-000-001"]);
  expect(sourceBox([250, 250, 500, 500], tasks[0]!.patch)).toEqual({
    x: 20,
    y: 20,
    width: 20,
    height: 20,
  });
});

test("internal clipping is rejected for owned objects; context and source boundaries remain legal", () => {
  const task = regions(definition)[0]!;
  const propose = (box_2d: number[]) => ({
    instances: [{ id: "seed", class: "seed", box_2d }],
  });
  expect(() =>
    validateProposal(propose([100, 400, 300, 1000]), task, definition),
  ).toThrow("internal patch boundary");
  expect(() =>
    validateProposal(propose([100, 0, 300, 100]), task, definition),
  ).not.toThrow();
  expect(() =>
    validateProposal(propose([100, 900, 300, 1000]), task, definition),
  ).not.toThrow();
  expect(() =>
    validateProposal(propose([100, 400, 300, Infinity]), task, definition),
  ).toThrow();
});

test("seam checks flag strong cross-region overlap and preserve same-region overlaps", () => {
  const first = {
    id: "a",
    class: "seed",
    taskId: "left",
    bbox: { x: 50, y: 10, width: 20, height: 10 },
  };
  const second = {
    ...first,
    id: "b",
    taskId: "right",
    bbox: { ...first.bbox, x: 55 },
  };
  expect(seamWarnings([first, second])).toHaveLength(1);
  expect(seamWarnings([first, { ...second, taskId: "left" }])).toEqual([]);
  expect(
    seamWarnings([first, { ...second, bbox: { ...second.bbox, y: 20 } }]),
  ).toEqual([]);
});
