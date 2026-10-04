import { test } from "bun:test";

import { expectIsolatedRun } from "../../../test/isolated";

test("a form shows a server error under its field", () =>
  expectIsolatedRun("test/kit-behavior.tsx", ["form"], "kit form behaves"));
