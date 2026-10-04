import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("calibration retains the mounted viewport's manual zoom and pan", () =>
  expectIsolatedRun(
    "test/calibration-lifecycle.tsx",
    [],
    "Calibration retains one viewport",
  ));
