import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { createAtomically } from "./files";
import { DATA_ROOT } from "./paths";

test("atomic creation never replaces an existing immutable file", () => {
  const filePath = path.join(DATA_ROOT, "atomic-create", "record.json");

  expect(createAtomically(filePath, "first\n")).toBe(true);
  expect(createAtomically(filePath, "second\n")).toBe(false);
  expect(fs.readFileSync(filePath, "utf-8")).toBe("first\n");
});
