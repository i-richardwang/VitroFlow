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
import { ensureDatasetModel } from "./model-registry";

const version = ensureDatasetModel("presence");
const heartbeat = {
  workerId: "presence-worker",
  startedAt: "2026-01-01T00:00:00+00:00",
  deployment: {
    modelVersionId: version.id,
    artifactDigest: version.artifact.digest,
  },
  runtime: {
    adapter: "traditional" as const,
    fingerprint: "b".repeat(64),
  },
  current: null,
};

function later(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

test("presence follows the age of the last heartbeat", () => {
  const seen = new Date("2026-01-01T00:10:00.000Z");
  const worker = recordInferenceHeartbeat(heartbeat, seen);
  expect(worker.lastSeenAt).toBe(seen.toISOString());
  expect(inferenceWorkerPresence(worker, later(seen, WORKER_ONLINE_SECONDS))).toBe("online");
  expect(inferenceWorkerPresence(worker, later(seen, WORKER_ONLINE_SECONDS + 1))).toBe("stale");
  expect(inferenceWorkerPresence(worker, later(seen, WORKER_STALE_SECONDS + 1))).toBe("offline");
});

test("listing forgets workers that have been silent for a week", () => {
  const seen = new Date("2026-01-01T00:00:00.000Z");
  recordInferenceHeartbeat({ ...heartbeat, workerId: "forgotten-worker" }, seen);
  const ids = (at: Date) =>
    listInferenceWorkers(at).map((worker) => worker.workerId);
  expect(ids(later(seen, 6 * 24 * 60 * 60))).toContain("forgotten-worker");
  expect(ids(later(seen, 8 * 24 * 60 * 60))).not.toContain("forgotten-worker");
});

test("heartbeat verifies a published deployment instead of registering it", () => {
  expect(() =>
    recordInferenceHeartbeat({
      ...heartbeat,
      deployment: { ...heartbeat.deployment, modelVersionId: "unknown-version" },
    }),
  ).toThrow(/Unknown model version/);
  expect(() =>
    recordInferenceHeartbeat({
      ...heartbeat,
      deployment: { ...heartbeat.deployment, artifactDigest: "c".repeat(64) },
    }),
  ).toThrow(/artifact does not match/);
});
