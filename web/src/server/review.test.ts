import { expect, test } from "bun:test";

import { recordInferenceOutcome } from "./inference-outcomes";
import { documentFromDetection } from "../annotation/detection";
import { saveAnnotation } from "./annotations";
import { readReview } from "./review";
import {
  TEST_RUNTIME,
  ULTRALYTICS_RUNTIME,
  observeImages,
  registerTestModel,
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
  expect(
    (await readReview(ref, "rv.jpg", first.version.id))?.detection,
  ).toEqual(older);
  expect((await readReview(ref, "rv.jpg", next.id))?.detection).toEqual(newer);
  expect((await readReview(ref, "rv.jpg"))?.filename).toBe("rv.jpg");

  await registerTestModel({
    schemaVersion: 1,
    id: "review-other",
    name: "Other task",
    task: "object_detection",
    classes: ["seed"],
    metrics: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
  });
  const foreign = await registerTrainedVersion("review-other");
  expect(await readReview(ref, "rv.jpg", foreign.id)).toBeNull();
  expect(await readReview(ref, "rv.jpg", "review-nowhere")).toBeNull();

  expect((await readReview(ref, "rv.jpg"))?.annotation).toBeNull();
  const saved = await saveAnnotation(ref, documentFromDetection(older));
  const started = await readReview(ref, "rv.jpg");
  expect(started?.annotation).toEqual(saved);
  expect(started?.detection).toEqual(newer);
  expect(
    (await readReview(ref, "rv.jpg", first.version.id))?.detection,
  ).toEqual(older);
});
