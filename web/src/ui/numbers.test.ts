import { describe, expect, test } from "bun:test";

import {
  formatCount,
  formatCountChange,
  formatDecimal,
  formatDecimalChange,
  formatNumber,
  formatPercent,
} from "./numbers";

describe("formatting", () => {
  test("counts carry the locale's digit grouping", () => {
    expect(formatCount(20)).toBe("20");
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

  test("changes carry their sign, and no change none", () => {
    expect(formatDecimalChange(51.48, 2)).toBe("+51.48");
    expect(formatCountChange(-158)).toBe("-158");
    expect(formatCountChange(0)).toBe("0");
  });
});
