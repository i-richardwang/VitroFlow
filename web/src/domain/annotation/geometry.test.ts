import { describe, expect, test } from "bun:test";

import { boxAround, clipToImage, moveBox, resizeBox } from "./geometry";

const image = { width: 100, height: 80 };

describe("clipToImage", () => {
  test("keeps an inner box unchanged", () => {
    expect(clipToImage({ x: 10, y: 10, width: 20, height: 20 }, image)).toEqual(
      {
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      },
    );
  });
  test("crops a box crossing the edge", () => {
    expect(clipToImage({ x: 90, y: -5, width: 20, height: 20 }, image)).toEqual(
      {
        x: 90,
        y: 0,
        width: 10,
        height: 15,
      },
    );
  });
  test("drops a box outside or too thin", () => {
    expect(
      clipToImage({ x: 120, y: 10, width: 20, height: 20 }, image),
    ).toBeNull();
    expect(
      clipToImage({ x: 99, y: 10, width: 20, height: 20 }, image),
    ).toBeNull();
  });
});

describe("boxAround", () => {
  test("centers a square on the point", () => {
    expect(boxAround({ x: 50, y: 40 }, 10, image)).toEqual({
      x: 45,
      y: 35,
      width: 10,
      height: 10,
    });
  });
});

describe("moveBox", () => {
  test("keeps size and stays inside the image", () => {
    const box = { x: 10, y: 10, width: 20, height: 20 };
    expect(moveBox(box, { x: 5, y: -3 }, image)).toEqual({
      x: 15,
      y: 7,
      width: 20,
      height: 20,
    });
    expect(moveBox(box, { x: 500, y: 500 }, image)).toEqual({
      x: 80,
      y: 60,
      width: 20,
      height: 20,
    });
  });
});

describe("resizeBox", () => {
  const box = { x: 20, y: 20, width: 20, height: 20 };
  test("drags a corner while the opposite corner stays fixed", () => {
    expect(resizeBox(box, "se", { x: 5, y: 10 }, image)).toEqual({
      x: 20,
      y: 20,
      width: 25,
      height: 30,
    });
    expect(resizeBox(box, "nw", { x: -5, y: 5 }, image)).toEqual({
      x: 15,
      y: 25,
      width: 25,
      height: 15,
    });
  });
  test("drags an edge only along its axis", () => {
    expect(resizeBox(box, "e", { x: 7, y: 99 }, image)).toEqual({
      x: 20,
      y: 20,
      width: 27,
      height: 20,
    });
  });
  test("never inverts or leaves the image", () => {
    expect(resizeBox(box, "w", { x: 100, y: 0 }, image).width).toBe(2);
    expect(resizeBox(box, "s", { x: 0, y: 500 }, image)).toEqual({
      x: 20,
      y: 20,
      width: 20,
      height: 60,
    });
  });
});
