import { expect, test } from "bun:test";

import { recordInferenceOutcome } from "./inference-outcomes";
import { instancesFromDetection } from "../annotation/detection";
import { saveAnnotation } from "./annotations";
import { readReview } from "./review";
import {
  TEST_RUNTIME,
  ULTRALYTICS_RUNTIME,
  observeImages,
  registerTrainedVersion,
  resultFor,
  testHeartbeat,
} from "./testing";
import { recordInferenceHeartbeat } from "./inference-worker-store";

test("a review shows the version the reviewer arrived from, else the newest", async () => {
  const worker = await recordInferenceHeartbeat({
    ...testHeartbeat("review-worker"),
    runtimes: [TEST_RUNTIME, ULTRALYTICS_RUNTIME],
  });
  const first = await observeImages("review v1", ["rv"]);
  const next = await registerTrainedVersion(first.version.modelId, "review-v2");
  await observeImages("review v2", ["rv"], next);
  const digest = first.digests[0]!;
  const ref = { digest, modelId: first.version.modelId };
  const older = await resultFor(first.version, "rv");
  const newer = await resultFor(next, "rv", ULTRALYTICS_RUNTIME);
  await recordInferenceOutcome(
    { versionId: first.version.id, digest },
    older,
    worker,
  );
  await recordInferenceOutcome({ versionId: next.id, digest }, newer, worker);

  expect((await readReview(ref, "rv.jpg"))?.detection).toEqual(newer);
  expect((await readReview(ref, "rv.jpg"))?.filename).toBe("rv.jpg");

  expect((await readReview(ref, "rv.jpg"))?.annotation).toBeNull();
  const saved = await saveAnnotation(ref, instancesFromDetection(older));
  const started = await readReview(ref, "rv.jpg");
  expect(started?.annotation).toEqual(saved);
  expect(started?.detection).toEqual(newer);
});
