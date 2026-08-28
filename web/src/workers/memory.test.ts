import { expect, test } from "bun:test";

import { formatGibibytes } from "./memory";

test("training memory uses binary units without overstating whole devices", () => {
  expect(formatGibibytes(24 * 1024 ** 3)).toBe("24 GiB");
  expect(formatGibibytes(19_069_665_280)).toBe("17.8 GiB");
});
