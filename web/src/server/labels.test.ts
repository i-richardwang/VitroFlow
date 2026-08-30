import { describe, expect, test } from "bun:test";

import type { AnnotationDocument } from "../annotation/schema";
import { documentFromDetection } from "../annotation/detection";
import { recordInferenceOutcome } from "./detections";
import {
  createLabel,
  createLabelFromDetection,
  readLabel,
  updateLabel,
} from "./labels";
import { registerModel } from "./model-registry";
import {
  FIXTURE_EDGE,
  baselineVersion,
  imageDigest,
  photographRound,
  registerTrainedVersion,
  resultFor,
  testHeartbeat,
} from "./testing";

const digest = await imageDigest("lb-a");

const document: AnnotationDocument = {
  schemaVersion: 1,
  image: { digest, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
  source: {
    modelVersionId: "seed-detector.traditional-v1",
    artifactDigest: "a".repeat(64),
    runtime: { adapter: "traditional", fingerprint: "b".repeat(64) },
  },
  status: "in_progress",
  revision: 0,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

describe("labels", () => {
  test("creates, reads, and updates with revision checks", async () => {
    const { version } = await photographRound("labels", ["lb-a"]);
    const validDocument = {
      ...document,
      source: {
        modelVersionId: version.id,
        artifactDigest: version.artifact.digest,
        runtime: document.source.runtime,
      },
    };
    const ref = { digest, model: version.modelId };
    expect(await readLabel(ref)).toBeNull();
    const created = await createLabel(ref, { ...validDocument, revision: 7 });
    expect(created.revision).toBe(0);
    await expect(createLabel(ref, validDocument)).rejects.toThrow(
      /already exists/,
    );

    const updated = await updateLabel(ref, {
      ...created,
      source: { ...created.source, artifactDigest: "f".repeat(64) },
      instances: [],
    });
    expect(updated.revision).toBe(1);
    expect(updated.source).toEqual(created.source);
    expect((await readLabel(ref))?.instances).toEqual([]);
    await expect(updateLabel(ref, created)).rejects.toThrow(/stale/);
  });

  test("belongs to a stored image", async () => {
    await expect(
      createLabel({ digest: "0".repeat(64), model: "seed-detector" }, document),
    ).rejects.toThrow(/not stored/);
  });

  test("describes the image it is stored under", async () => {
    await photographRound("labels-other", ["lb-b"]);
    const other = await imageDigest("lb-b");
    await expect(
      createLabel({ digest: other, model: "seed-detector" }, document),
    ).rejects.toThrow();
  });

  test("uses the canonical image dimensions", async () => {
    const { version } = await photographRound("dimensions", ["dimensions"]);
    const image = await imageDigest("dimensions");
    await expect(
      createLabel(
        { digest: image, model: version.modelId },
        {
          ...document,
          source: {
            ...document.source,
            modelVersionId: version.id,
            artifactDigest: version.artifact.digest,
          },
          image: { digest: image, width: 1, height: 1 },
          instances: [],
        },
      ),
    ).rejects.toThrow(/1x1/);
  });

  test("binds the review source to a registered artifact of its model", async () => {
    const { version } = await photographRound("label-source", ["label-source"]);
    const image = await imageDigest("label-source");
    const valid = {
      ...document,
      image: { digest: image, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    };
    await expect(
      createLabel(
        { digest: image, model: version.modelId },
        {
          ...valid,
          source: {
            modelVersionId: version.id,
            artifactDigest: "f".repeat(64),
            runtime: document.source.runtime,
          },
        },
      ),
    ).rejects.toThrow();

    await registerModel({
      schemaVersion: 1,
      id: "germination",
      name: "Germination detector",
      task: "object_detection",
      classes: ["seed"],
    });
    const germination = await registerTrainedVersion("germination");
    await expect(
      createLabel(
        { digest: image, model: "germination" },
        {
          ...valid,
          source: {
            modelVersionId: version.id,
            artifactDigest: version.artifact.digest,
            runtime: document.source.runtime,
          },
        },
      ),
    ).rejects.toThrow(/not a version of germination/);
    const forGermination = await createLabel(
      { digest: image, model: "germination" },
      {
        ...valid,
        source: {
          modelVersionId: germination.id,
          artifactDigest: germination.artifact.digest,
          runtime: { adapter: "ultralytics", fingerprint: "e".repeat(64) },
        },
      },
    );
    expect(forGermination.source.modelVersionId).toBe(germination.id);
    expect(
      await readLabel({ digest: image, model: version.modelId }),
    ).toBeNull();
  });

  test("starts from what a version found and is one document per image and model", async () => {
    const baseline = await baselineVersion();
    const { version } = await photographRound("label-start", ["start"]);
    const image = await imageDigest("start");
    const ref = { digest: image, model: version.modelId };
    await expect(createLabelFromDetection(ref, version.id)).rejects.toThrow(
      /has not detected/,
    );
    const result = await resultFor(baseline, "start");
    await recordInferenceOutcome(
      { versionId: baseline.id, digest: image },
      result,
      { runtimes: testHeartbeat("label-start-worker").runtimes },
    );
    const started = await createLabelFromDetection(ref, baseline.id);
    expect(started).toEqual({ ...documentFromDetection(result), revision: 0 });
    expect(await readLabel(ref)).toEqual(started);
  });
});
