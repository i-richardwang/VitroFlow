import { describe, expect, test } from "bun:test";

import { summarize } from "../domain/experiments/readings";
import { formatCount, formatCountSummary } from "./readings";

describe("formatting", () => {
  test("counts read as whole numbers, averages to one decimal", () => {
    expect(formatCount(20)).toBe("20");
    expect(formatCount(19.5)).toBe("19.5");
    expect(formatCount(null)).toBe("—");
  });

  test("a summary carries its spread and its sample size", () => {
    expect(formatCountSummary(summarize([18, 20, 22]))).toBe("20 ± 2 (n = 3)");
  });

  test("a summary of nothing reads as nothing", () => {
    expect(formatCountSummary(summarize([]))).toBe("—");
  });
});
