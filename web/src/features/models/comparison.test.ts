import { describe, expect, test } from "bun:test";

import { movement } from "./comparison";

describe("movement", () => {
  test("a lower error is better", () => {
    expect(movement(46.91, 98.39)).toBe("worse");
    expect(movement(46.91, 30)).toBe("better");
  });

  test("a move too small to show is none", () => {
    expect(movement(46.912, 46.914)).toBe("none");
  });
});
