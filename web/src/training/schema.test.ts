import { expect, test } from "bun:test";

import { isTrainingRunActive } from "./schema";

test("active training states include recoverable publication", () => {
  expect(isTrainingRunActive({ state: { status: "queued" } })).toBeTrue();
  expect(
    isTrainingRunActive({
      state: {
        status: "running",
        workerId: "trainer",
        leaseExpiresAt: "2026-08-28T00:00:00.000Z",
        phase: "training",
        progress: 0.5,
      },
    }),
  ).toBeTrue();
  expect(
    isTrainingRunActive({
      state: { status: "publishing", workerId: "trainer" },
    }),
  ).toBeTrue();
  expect(
    isTrainingRunActive({
      state: { status: "succeeded", modelVersionId: "model.version" },
    }),
  ).toBeFalse();
  expect(
    isTrainingRunActive({ state: { status: "failed", error: "failed" } }),
  ).toBeFalse();
});
