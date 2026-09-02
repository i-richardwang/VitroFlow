import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatTimestampUtc, Timestamp } from "./Timestamp";

test("timestamps render deterministic UTC text", () => {
  const value = "2026-08-31T00:00:00.000Z";
  const html = renderToStaticMarkup(<Timestamp value={value} />);
  expect(formatTimestampUtc(value)).toContain("UTC");
  expect(html).toContain(formatTimestampUtc(value));
});
