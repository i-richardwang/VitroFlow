import { expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import {
  LEASE_SECONDS,
  ONLINE_SECONDS,
  holdsLease,
  listWorkers,
  recordHeartbeat,
  workerPresence,
} from "./worker-store";

const { pipeline, model, config } = makeResult([]);
const heartbeat = {
  workerId: "presence-worker",
  startedAt: "2026-01-01T00:00:00+00:00",
  execution: { pipeline, model, config },
  currentJobId: null,
};

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence and lease follow the age of the last heartbeat", () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = recordHeartbeat(heartbeat, seen);
  expect(worker.lastSeenAt).toBe(seen.toISOString());

  expect(workerPresence(worker, later(seen, ONLINE_SECONDS))).toBe("online");
  expect(workerPresence(worker, later(seen, ONLINE_SECONDS + 1))).toBe("stale");
  expect(workerPresence(worker, later(seen, LEASE_SECONDS + 1))).toBe(
    "offline",
  );

  expect(holdsLease("presence-worker", later(seen, LEASE_SECONDS))).toBe(true);
  expect(holdsLease("presence-worker", later(seen, LEASE_SECONDS + 1))).toBe(
    false,
  );
  expect(holdsLease("unknown-worker", seen)).toBe(false);
});

test("listing forgets workers that have been silent for a week", () => {
  const seen = new Date("2026-01-01T00:00:00.000Z");
  recordHeartbeat({ ...heartbeat, workerId: "forgotten-worker" }, seen);
  const ids = (at: Date) => listWorkers(at).map((worker) => worker.workerId);

  expect(ids(later(seen, 6 * 24 * 60 * 60))).toContain("forgotten-worker");
  expect(ids(later(seen, 8 * 24 * 60 * 60))).not.toContain("forgotten-worker");
});
