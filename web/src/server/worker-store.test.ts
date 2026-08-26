import { expect, test } from "bun:test";

import {
  ONLINE_SECONDS,
  STALE_SECONDS,
  listWorkers,
  recordHeartbeat,
  workerPresence,
} from "./worker-store";

const heartbeat = {
  workerId: "presence-worker",
  startedAt: "2026-01-01T00:00:00+00:00",
  prelabeler: {
    version_id: "traditional-test",
    name: "Traditional test",
    kind: "traditional",
    fingerprint: "b".repeat(64),
  },
  current: null,
};

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence follows the age of the last heartbeat", () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = recordHeartbeat(heartbeat, seen);
  expect(worker.lastSeenAt).toBe(seen.toISOString());

  expect(workerPresence(worker, later(seen, ONLINE_SECONDS))).toBe("online");
  expect(workerPresence(worker, later(seen, ONLINE_SECONDS + 1))).toBe("stale");
  expect(workerPresence(worker, later(seen, STALE_SECONDS))).toBe("stale");
  expect(workerPresence(worker, later(seen, STALE_SECONDS + 1))).toBe(
    "offline",
  );
});

test("listing forgets workers that have been silent for a week", () => {
  const seen = new Date("2026-01-01T00:00:00.000Z");
  recordHeartbeat({ ...heartbeat, workerId: "forgotten-worker" }, seen);
  const ids = (at: Date) => listWorkers(at).map((worker) => worker.workerId);

  expect(ids(later(seen, 6 * 24 * 60 * 60))).toContain("forgotten-worker");
  expect(ids(later(seen, 8 * 24 * 60 * 60))).not.toContain("forgotten-worker");
});
