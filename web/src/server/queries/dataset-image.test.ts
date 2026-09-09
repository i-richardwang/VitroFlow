import { expect, test } from "bun:test";

import { readDatasetImage } from "./dataset-image";
import { seedInferenceOutcome } from "../testing/inference";
import {
  imageDigest,
  resultFor,
  testHeartbeat,
  uploadTexts,
} from "../testing/fixtures";

test("a dataset image page steps through the dataset in its order", async () => {
  const { version } = await uploadTexts("di", ["di-a", "di-b", "di-c"]);
  const [a, b, c] = await Promise.all(
    ["di-a", "di-b", "di-c"].map((name) => imageDigest(name)),
  );
  const result = await resultFor(version, "di-b");
  await seedInferenceOutcome({ versionId: version.id, digest: b! }, result, {
    runtimes: testHeartbeat("di-worker").runtimes,
  });

  const middle = await readDatasetImage({ dataset: "di", digest: b! });
  expect(middle?.model.id).toBe(version.modelId);
  expect(middle?.review).toEqual({
    ref: { digest: b!, modelId: version.modelId },
    filename: "di-b.jpg",
    width: middle!.review.width,
    height: middle!.review.height,
    detection: result,
    annotation: null,
  });
  expect(middle?.previous).toEqual({ digest: a!, filename: "di-a.jpg" });
  expect(middle?.next).toEqual({ digest: c!, filename: "di-c.jpg" });

  const first = await readDatasetImage({ dataset: "di", digest: a! });
  expect(first?.previous).toBeNull();
  expect(first?.review.detection).toBeNull();

  expect(
    await readDatasetImage({ dataset: "di", digest: "0".repeat(64) }),
  ).toBeNull();
  expect(await readDatasetImage({ dataset: "nowhere", digest: a! })).toBeNull();
});
