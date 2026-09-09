import { expect, test } from "bun:test";

import {
  WORKER_ONLINE_SECONDS,
  WORKER_STALE_SECONDS,
  workerPresence,
} from "../../workers/presence";
import {
  TEST_RUNTIME,
  ULTRALYTICS_RUNTIME,
  testHeartbeat,
} from "../testing/fixtures";
import {
  WorkerSessionConflictError,
  currentWorkerSession,
  listOnlineTrainers,
  listWorkers,
  recordWorkerHeartbeat,
} from "./sessions";

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence follows the age of the last heartbeat", async () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = await recordWorkerHeartbeat(
    testHeartbeat("presence-worker"),
    seen,
  );
  expect(worker.lastSeenAt).toBe(seen.toISOString());
  const presence = (seconds: number) =>
    workerPresence(worker.lastSeenAt, later(seen, seconds));
  expect(presence(WORKER_ONLINE_SECONDS)).toBe("online");
  expect(presence(WORKER_ONLINE_SECONDS + 1)).toBe("stale");
  expect(presence(WORKER_STALE_SECONDS + 1)).toBe("offline");
});

test("listing forgets workers that have been silent for a week", async () => {
  const seen = new Date("2026-01-01T00:00:00.000Z");
  await recordWorkerHeartbeat(testHeartbeat("forgotten-worker"), seen);
  const ids = async (at: Date) =>
    (await listWorkers(at)).map((worker) => worker.workerId);
  expect(await ids(later(seen, 6 * 24 * 60 * 60))).toContain(
    "forgotten-worker",
  );
  expect(await ids(later(seen, 8 * 24 * 60 * 60))).not.toContain(
    "forgotten-worker",
  );
});

test("a worker trains only with the ultralytics runtime", async () => {
  const seen = new Date("2026-02-01T00:00:00.000Z");
  await recordWorkerHeartbeat(testHeartbeat("detector-only"), seen);
  await recordWorkerHeartbeat(
    {
      ...testHeartbeat("trainer"),
      runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
    },
    seen,
  );
  const trainers = (await listOnlineTrainers(seen)).map(
    (worker) => worker.workerId,
  );
  expect(trainers).toContain("trainer");
  expect(trainers).not.toContain("detector-only");
});

test("an older session cannot replace a newer process with the same worker id", async () => {
  const heartbeat = {
    ...testHeartbeat("restarted-worker"),
    startedAt: "2026-01-01T00:00:00+00:00",
  };
  const newer = {
    ...heartbeat,
    sessionId: "newer-session",
    startedAt: "2026-01-02T00:00:00+00:00",
  };
  await recordWorkerHeartbeat(newer);
  await expect(recordWorkerHeartbeat(heartbeat)).rejects.toBeInstanceOf(
    WorkerSessionConflictError,
  );
  await expect(currentWorkerSession(heartbeat)).rejects.toBeInstanceOf(
    WorkerSessionConflictError,
  );
  expect((await currentWorkerSession(newer)).sessionId).toBe("newer-session");
});
