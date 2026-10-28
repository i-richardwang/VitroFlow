import { expect, test } from "bun:test";

import type { TrainingRun } from "./schema";
import { TRAINING_STALL_MINUTES, trainingRunStall } from "./stall";

const AT = new Date("2026-08-28T12:00:00.000Z");
const minutesBefore = (minutes: number) =>
  new Date(AT.getTime() - minutes * 60_000).toISOString();

function running(
  lastProgressAt: string | null,
): Pick<TrainingRun, "state" | "lastProgressAt"> {
  return {
    lastProgressAt,
    state: {
      status: "running",
      workerId: "trainer",
      sessionId: "trainer-session",
      leaseExpiresAt: new Date(AT.getTime() + 4 * 60_000).toISOString(),
      phase: "training",
      progress: 0.5,
    },
  };
}

const held = { at: AT, leaseHeld: true };

test("a running run moving within the threshold is not stalled", () => {
  expect(
    trainingRunStall(running(minutesBefore(TRAINING_STALL_MINUTES)), held),
  ).toBeNull();
  expect(trainingRunStall(running(null), held)).toBeNull();
});

test("a running run without progress past the threshold has stalled", () => {
  expect(
    trainingRunStall(running(minutesBefore(TRAINING_STALL_MINUTES + 1)), held),
  ).toBe("no-progress");
});

test("a run its worker no longer holds has lost its worker", () => {
  const lost = { at: AT, leaseHeld: false };
  expect(trainingRunStall(running(minutesBefore(1)), lost)).toBe("worker-lost");
  expect(
    trainingRunStall(running(minutesBefore(TRAINING_STALL_MINUTES + 1)), lost),
  ).toBe("worker-lost");
});

test("only a running run can stall", () => {
  const unheld = { at: AT, leaseHeld: false };
  expect(
    trainingRunStall(
      { lastProgressAt: minutesBefore(60), state: { status: "paused" } },
      unheld,
    ),
  ).toBeNull();
  expect(
    trainingRunStall(
      { lastProgressAt: null, state: { status: "queued" } },
      unheld,
    ),
  ).toBeNull();
});
