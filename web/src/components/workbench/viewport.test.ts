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
  test("zoomed cannot expose the frame behind the image", () => {
    const view = resolveView(
      { kind: "zoomed", scale: 2, x: 50, y: -1000 },
      { width: 200, height: 300 },
      image,
    );
    expect(view).toEqual({ scale: 2, x: 0, y: -300, filled: false });
  });
  test("zoomed cannot go below fill or above the maximum", () => {
    const frame = { width: 200, height: 300 };
    expect(
      resolveView({ kind: "zoomed", scale: 0.1, x: -100, y: 0 }, frame, image),
    ).toEqual({ scale: 1, x: -100, y: 0, filled: false });
    expect(
      resolveView({ kind: "zoomed", scale: 1000, x: 0, y: 0 }, frame, image)
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
      { kind: "zoomed", scale: 2, x: 0, y: 0 },
      frame,
      image,
    );
    expect(zoomedAbout(before, { x: 0, y: 0 }, 0.9, frame, image)).toBe(FILL);
  });
});
