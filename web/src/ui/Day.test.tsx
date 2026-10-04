import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Day, formatDay } from "./Day";

test("a calendar day keeps its date in every time zone", () => {
  const zone = process.env.TZ;
  try {
    for (const tz of ["America/Los_Angeles", "UTC", "Asia/Shanghai"]) {
      process.env.TZ = tz;
      expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  expect(renderToStaticMarkup(<Day value="2026-01-01" />)).toBe(
    '<time dateTime="2026-01-01">Jan 1, 2026</time>',
  );
});
