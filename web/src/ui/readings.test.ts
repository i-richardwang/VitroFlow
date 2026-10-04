import { describe, expect, test } from "bun:test";

import { formatCount } from "./readings";

describe("formatting", () => {
  test("counts read as whole numbers, averages to one decimal", () => {
    expect(formatCount(20)).toBe("20");
    expect(formatCount(19.5)).toBe("19.5");
  });
});
