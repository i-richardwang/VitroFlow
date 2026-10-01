import { expect, test } from "bun:test";
import { regions, owns, prepareProposal, seamWarnings, tiles } from "./tasks";
import { collectRegions } from "./results";
import type { AnnotationDefinition } from "./schema";
const definition: AnnotationDefinition = {
  input: null,
  scope: null,
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
  const prepared = prepareProposal(
    {
      instances: [{ id: "seed", class: "seed", box_2d: [250, 250, 500, 500] }],
    },
    tasks[0]!,
    definition,
  );
  expect(prepared.content.document.instances[0]!.bbox).toEqual({
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
    prepareProposal(propose([100, 400, 300, 1000]), task, definition),
  ).toThrow("internal patch boundary");
  expect(() =>
    prepareProposal(propose([100, 0, 300, 100]), task, definition),
  ).not.toThrow();
  expect(() =>
    prepareProposal(propose([100, 900, 300, 1000]), task, definition),
  ).not.toThrow();
  expect(() =>
    prepareProposal(propose([100, 400, 300, Infinity]), task, definition),
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

test("decimal source-edge boxes preview and collect identically, with halo-only boxes excluded", () => {
  for (const width of [17, 544, 1536]) {
    const frame = {
      ...definition,
      image: { ...definition.image, width, height: 17 },
    };
    const region = regions(frame).at(-1)!;
    const { response, content: preview } = prepareProposal(
      {
        instances: [
          {
            id: "edge",
            class: "seed",
            box_2d: [1.4, 801.4, 1000, 1000],
          },
        ],
      },
      region,
      frame,
    );
    expect(preview.document.instances).toHaveLength(1);
    const box = preview.document.instances[0]!.bbox;
    expect(box.x + box.width).toBe(width);
    expect(box.y + box.height).toBe(frame.image.height);
    const collected = collectRegions(frame, [
      { taskId: "run/edge", region, response },
    ]);
    expect(collected.document.instances[0]!.bbox).toEqual(box);
    expect(collected.uncertainIds).toEqual(["run/edge/edge"]);
  }
  const region = regions(definition)[0]!;
  const { response, content: preview } = prepareProposal(
    {
      instances: [
        { id: "owned", class: "seed", box_2d: [100, 200, 300, 400] },
        { id: "neighbor", class: "seed", box_2d: [100, 900, 300, 1000] },
      ],
    },
    region,
    definition,
  );
  expect(preview.document.instances.map((item) => item.id)).toEqual(["owned"]);
  expect(
    collectRegions(definition, [
      { taskId: "run/region", region, response },
    ]).document.instances.map((item) => item.id),
  ).toEqual(["run/region/owned"]);
});

test("fractional boxes touching the source boundary remain valid through collection", () => {
  const frame = {
    ...definition,
    image: { ...definition.image, width: 17, height: 512 },
    config: { ...definition.config, coreSize: 512, halo: 0 },
  };
  const region = regions(frame)[0]!;
  const { response, content: preview } = prepareProposal(
    { instances: [{ id: "s", class: "seed", box_2d: [100, 1.4, 300, 1000] }] },
    region,
    frame,
  );
  expect(preview.document.instances).toHaveLength(1);
  const result = collectRegions(frame, [
    { taskId: "run/region", region, response },
  ]);
  const box = result.document.instances[0]!.bbox;
  expect(box.x + box.width).toBe(17);
});

test("a scope selects the regions it touches, and the result keeps the input boxes of the others", () => {
  const kept = {
    id: "kept",
    class: "seed",
    bbox: { x: 4, y: 4, width: 8, height: 8 },
  };
  const replaced = {
    id: "replaced",
    class: "seed",
    bbox: { x: 100, y: 10, width: 8, height: 8 },
  };
  const scoped: AnnotationDefinition = {
    ...definition,
    input: [kept, replaced],
    scope: [{ x: 90, y: 0, width: 20, height: 20 }],
  };
  expect(tiles(scoped)).toHaveLength(4);
  const redrawn = regions(scoped);
  expect(redrawn.map((region) => region.id)).toEqual(["tile-000-001"]);
  const result = collectRegions(scoped, [
    {
      taskId: "run/tile-000-001",
      region: redrawn[0]!,
      response: {
        instances: [
          {
            id: "s1",
            class: "seed",
            box_2d: [200, 400, 400, 600],
            uncertain: false,
            truncated: false,
          },
        ],
        issues: [],
      },
    },
  ]);
  expect(result.document.instances.map((instance) => instance.id)).toEqual([
    "run/tile-000-001/s1",
    "kept",
  ]);
  expect(
    regions({ ...scoped, scope: [{ x: 0, y: 0, width: 120, height: 80 }] }),
  ).toHaveLength(4);
});
