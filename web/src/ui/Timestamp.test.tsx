import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatTimestamp, Timestamp } from "./Timestamp";

const VALUE = "2026-08-31T00:00:00.000Z";

test("the server writes an instant in UTC and names the zone", () => {
  const html = renderToStaticMarkup(<Timestamp value={VALUE} />);
  expect(formatTimestamp(VALUE, "UTC")).toContain("UTC");
  expect(html).toContain(formatTimestamp(VALUE, "UTC"));
});

test("on the reader's clock an instant moves with their zone and names none", () => {
  const local = formatTimestamp(VALUE, "Asia/Shanghai");
  expect(local).not.toContain("UTC");
  expect(local).not.toBe(formatTimestamp(VALUE, "America/New_York"));
});
