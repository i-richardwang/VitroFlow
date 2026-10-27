import { test } from "bun:test";
import { expectIsolatedRun } from "../../../test/isolated";

test("switching training presets resets overrides and submits only adjustments", () =>
  expectIsolatedRun("test/training-dialog.tsx", [], "training presets behave"));
