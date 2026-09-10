import { expect, test } from "bun:test";

import { database } from "../infra/db/client";
import { seedInferenceOutcome } from "../testing/inference";
import { instancesFromDetection } from "../../domain/annotation/detection";
import { storeAnnotation } from "./documents";
import { readReview } from "./review";
import {
  TEST_RUNTIME,
  ULTRALYTICS_RUNTIME,
  observeImages,
  registerTrainedVersion,
  traditionalVersion,
  resultFor,
  testHeartbeat,
} from "../testing/fixtures";
import { recordWorkerHeartbeat } from "../workers/sessions";

test("a review shows the newest detection and the stored annotation", async () => {
  const worker = await recordWorkerHeartbeat({
    ...testHeartbeat("review-worker"),
    runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
  });
  const baseline = await traditionalVersion("review-detector", "review-v1");
  const first = await observeImages("review v1", ["rv"], baseline);
  const next = await registerTrainedVersion(first.version.modelId, "review-v2");
  await observeImages("review v2", ["rv"], next);
  const digest = first.digests[0]!;
  const ref = { digest, modelId: first.version.modelId };
  const older = await resultFor(first.version, "rv");
  const newer = await resultFor(next, "rv", ULTRALYTICS_RUNTIME);
  await seedInferenceOutcome(
    { versionId: first.version.id, digest },
    older,
    worker,
  );
  await seedInferenceOutcome({ versionId: next.id, digest }, newer, worker);
  const db = await database();

  expect((await readReview(ref, "rv.jpg", db))?.detection).toEqual(newer);
  expect((await readReview(ref, "rv.jpg", db))?.filename).toBe("rv.jpg");

  expect((await readReview(ref, "rv.jpg", db))?.annotation).toBeNull();
  const saved = await storeAnnotation(ref, instancesFromDetection(older), null);
  const reviewed = await readReview(ref, "rv.jpg", db);
  expect(reviewed?.annotation).toEqual(saved);
  expect(reviewed?.detection).toEqual(newer);
});
