import { expect, test } from "bun:test";

import {
  WORKER_ONLINE_SECONDS,
  WORKER_STALE_SECONDS,
} from "../workers/presence";
import {
  inferenceWorkerPresence,
  listInferenceWorkers,
  recordInferenceHeartbeat,
} from "./inference-worker-store";
import { baselineVersion } from "./testing";

const version = await baselineVersion();
const heartbeat = {
  workerId: "presence-worker",
  startedAt: "2026-01-01T00:00:00+00:00",
  runtimes: [{ adapter: "traditional" as const, fingerprint: "b".repeat(64) }],
  loaded: null,
  current: null,
};

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence follows the age of the last heartbeat", async () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = await recordInferenceHeartbeat(heartbeat, seen);
  expect(worker.lastSeenAt).toBe(seen.toISOString());
  expect(
    inferenceWorkerPresence(worker, later(seen, WORKER_ONLINE_SECONDS)),
  ).toBe("online");
  expect(
    inferenceWorkerPresence(worker, later(seen, WORKER_ONLINE_SECONDS + 1)),
  ).toBe("stale");
  expect(
    inferenceWorkerPresence(worker, later(seen, WORKER_STALE_SECONDS + 1)),
  ).toBe("offline");
});

test("listing forgets workers that have been silent for a week", async () => {
  const seen = new Date("2026-01-01T00:00:00.000Z");
  await recordInferenceHeartbeat(
    { ...heartbeat, workerId: "forgotten-worker" },
    seen,
  );
  const ids = async (at: Date) =>
    (await listInferenceWorkers(at)).map((worker) => worker.workerId);
  expect(await ids(later(seen, 6 * 24 * 60 * 60))).toContain(
    "forgotten-worker",
  );
  expect(await ids(later(seen, 8 * 24 * 60 * 60))).not.toContain(
    "forgotten-worker",
  );
});

test("a loaded version must exist and match the worker's runtimes", async () => {
  await expect(
    recordInferenceHeartbeat({ ...heartbeat, loaded: "unknown-version" }),
  ).rejects.toThrow(/Unknown model version/);
  await expect(
    recordInferenceHeartbeat({
      ...heartbeat,
      runtimes: [{ adapter: "ultralytics", fingerprint: "c".repeat(64) }],
      loaded: version.id,
    }),
  ).rejects.toThrow(/cannot execute/);
  const worker = await recordInferenceHeartbeat({
    ...heartbeat,
    loaded: version.id,
  });
  expect(worker.loaded).toBe(version.id);
});

test("the current digest must name a stored image", async () => {
  await expect(
    recordInferenceHeartbeat({
      ...heartbeat,
      workerId: "unknown-image-worker",
      current: "0".repeat(64),
    }),
  ).rejects.toThrow();
});
