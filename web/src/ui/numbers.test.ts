import { describe, expect, test } from "bun:test";

import {
  formatCount,
  formatDecimal,
  formatNumber,
  formatPercent,
} from "./numbers";

describe("formatting", () => {
  test("counts read as whole numbers, averages to one decimal", () => {
    expect(formatCount(20)).toBe("20");
    expect(formatCount(19.5)).toBe("19.5");
    expect(formatCount(19.25)).toBe("19.3");
  });

  test("whole counts carry the locale's digit grouping", () => {
    expect(formatCount(12000)).toBe("12,000");
  });

  test("metrics keep their fixed decimals", () => {
    expect(formatDecimal(0.5, 3)).toBe("0.500");
  });

  test("configured values keep every decimal", () => {
    expect(formatNumber(0.00001)).toBe("0.00001");
  });

  test("ratios read as whole percents", () => {
    expect(formatPercent(0.426)).toBe("43%");
  });
});
