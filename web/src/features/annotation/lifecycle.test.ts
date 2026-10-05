import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("an image page retains its mounted viewport's manual zoom and pan", () =>
  expectIsolatedRun(
    "test/annotation-lifecycle.tsx",
    [],
    "The image page retains one viewport",
  ));
