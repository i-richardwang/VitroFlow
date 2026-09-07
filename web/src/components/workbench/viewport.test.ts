import { describe, expect, test } from "bun:test";

import {
  FILL,
  MAX_SCALE,
  pannedTo,
  resolveView,
  zoomedAbout,
} from "./viewport";

const image = { width: 400, height: 300 };

describe("resolveView", () => {
  test("fill covers the frame and centers the overflowing side", () => {
    expect(resolveView(FILL, { width: 200, height: 300 }, image)).toEqual({
      scale: 1,
      x: -100,
      y: 0,
      filled: true,
    });
    expect(resolveView(FILL, { width: 400, height: 100 }, image)).toEqual({
      scale: 1,
      x: 0,
      y: -100,
      filled: true,
    });
  });
  test("fill follows the frame when it changes", () => {
    const tall = resolveView(FILL, { width: 200, height: 300 }, image);
    const wide = resolveView(FILL, { width: 800, height: 300 }, image);
    expect(tall.scale).toBe(1);
    expect(wide.scale).toBe(2);
  });
  test("manual cannot expose the frame behind the image", () => {
    const view = resolveView(
      { kind: "manual", scale: 2, x: 50, y: -1000 },
      { width: 200, height: 300 },
      image,
    );
    expect(view).toEqual({ scale: 2, x: 0, y: -300, filled: false });
  });
  test("manual cannot go below fill or above the maximum", () => {
    const frame = { width: 200, height: 300 };
    expect(
      resolveView({ kind: "manual", scale: 0.1, x: -100, y: 0 }, frame, image),
    ).toEqual({ scale: 1, x: -100, y: 0, filled: false });
    expect(
      resolveView({ kind: "manual", scale: 1000, x: 0, y: 0 }, frame, image)
        .scale,
    ).toBe(MAX_SCALE);
  });
  test("panning at the filling scale slides the overflowing side", () => {
    const frame = { width: 200, height: 300 };
    const filled = resolveView(FILL, frame, image);
    const panned = resolveView(pannedTo(filled, -200, 50), frame, image);
    expect(panned).toEqual({ scale: 1, x: -200, y: 0, filled: false });
  });
  test("an unmeasured frame shows the image as is", () => {
    expect(resolveView(FILL, null, image)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
      filled: true,
    });
  });
});

describe("zoomedAbout", () => {
  const frame = { width: 200, height: 300 };
  test("holds the image pixel under the anchor still", () => {
    const before = resolveView(FILL, frame, image);
    const anchor = { x: 100, y: 150 };
    const intent = zoomedAbout(before, anchor, 2, frame, image);
    const after = resolveView(intent, frame, image);
    const pixelBefore = (anchor.x - before.x) / before.scale;
    const pixelAfter = (anchor.x - after.x) / after.scale;
    expect(pixelAfter).toBeCloseTo(pixelBefore);
  });
  test("returns to fill when zooming out past it", () => {
    const before = resolveView(
      { kind: "manual", scale: 2, x: 0, y: 0 },
      frame,
      image,
    );
    expect(zoomedAbout(before, { x: 0, y: 0 }, 0.9, frame, image)).toBe(FILL);
  });
});

test("wheel zoom at the limit keeps both anchor coordinates fixed", () => {
  const frame = { width: 200, height: 300 };
  const before = resolveView(
    { kind: "manual", scale: 40, x: -7900, y: -5850 },
    frame,
    image,
  );
  const anchor = { x: 100, y: 150 };
  const after = resolveView(
    zoomedAbout(before, anchor, 80, frame, image),
    frame,
    image,
  );
  expect(after).toEqual(before);
  const below = resolveView(
    { kind: "manual", scale: 20, x: -3900, y: -2850 },
    frame,
    image,
  );
  const crossing = resolveView(
    zoomedAbout(below, anchor, 80, frame, image),
    frame,
    image,
  );
  expect(crossing.scale).toBe(MAX_SCALE);
  expect((anchor.x - crossing.x) / crossing.scale).toBeCloseTo(
    (anchor.x - below.x) / below.scale,
  );
  expect((anchor.y - crossing.y) / crossing.scale).toBeCloseTo(
    (anchor.y - below.y) / below.scale,
  );
});

test("a small image still covers the frame during manual gestures and resizing", () => {
  const frame = { width: 200, height: 300 };
  const tiny = { width: 2, height: 2 };
  const filled = resolveView(FILL, frame, tiny);
  const panned = resolveView(pannedTo(filled, -20, 0), frame, tiny);
  expect(panned.scale).toBe(150);
  expect(panned.x).toBe(-20);
  expect(
    resolveView(
      zoomedAbout(panned, { x: 100, y: 150 }, 200, frame, tiny),
      frame,
      tiny,
    ).scale,
  ).toBe(150);
  const resized = resolveView(
    pannedTo(panned, panned.x, panned.y),
    { width: 400, height: 600 },
    tiny,
  );
  expect(resized.scale).toBe(300);
});
