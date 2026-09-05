import { describe, expect, test } from "bun:test";

import { FIT, MAX_SCALE, resolveView, zoomedAbout } from "./viewport";

const image = { width: 400, height: 300 };

describe("resolveView", () => {
  test("fit fills the binding side and centers the other", () => {
    expect(resolveView(FIT, { width: 200, height: 300 }, image)).toEqual({
      scale: 0.5,
      x: 0,
      y: 75,
      fitted: true,
    });
  });
  test("fit follows the frame when it changes", () => {
    const wide = resolveView(FIT, { width: 800, height: 300 }, image);
    const narrow = resolveView(FIT, { width: 200, height: 300 }, image);
    expect(wide.scale).toBe(1);
    expect(narrow.scale).toBe(0.5);
  });
  test("zoomed keeps the image over the frame", () => {
    const view = resolveView(
      { kind: "zoomed", scale: 2, x: 50, y: -1000 },
      { width: 200, height: 300 },
      image,
    );
    expect(view).toEqual({ scale: 2, x: 0, y: -300, fitted: false });
  });
  test("zoomed cannot go below fit or above the maximum", () => {
    const frame = { width: 200, height: 300 };
    expect(
      resolveView({ kind: "zoomed", scale: 0.1, x: 0, y: 0 }, frame, image),
    ).toEqual(resolveView(FIT, frame, image));
    expect(
      resolveView({ kind: "zoomed", scale: 1000, x: 0, y: 0 }, frame, image)
        .scale,
    ).toBe(MAX_SCALE);
  });
  test("an unmeasured frame shows the image as is", () => {
    expect(resolveView(FIT, null, image)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
      fitted: true,
    });
  });
});

describe("zoomedAbout", () => {
  const frame = { width: 200, height: 300 };
  test("holds the image pixel under the anchor still", () => {
    const before = resolveView(FIT, frame, image);
    const anchor = { x: 100, y: 150 };
    const intent = zoomedAbout(before, anchor, 1, frame, image);
    const after = resolveView(intent, frame, image);
    const pixelBefore = (anchor.x - before.x) / before.scale;
    const pixelAfter = (anchor.x - after.x) / after.scale;
    expect(pixelAfter).toBeCloseTo(pixelBefore);
  });
  test("returns to fit when zooming out past it", () => {
    const before = resolveView(
      { kind: "zoomed", scale: 1, x: 0, y: 0 },
      frame,
      image,
    );
    expect(zoomedAbout(before, { x: 0, y: 0 }, 0.4, frame, image)).toBe(FIT);
  });
});
