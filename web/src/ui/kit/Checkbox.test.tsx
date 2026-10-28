import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a disabled option of a checkbox group holds its state", () =>
  expectIsolatedRun(
    "test/kit-behavior.tsx",
    ["checkboxGroup"],
    "kit checkboxGroup behaves",
  ));
