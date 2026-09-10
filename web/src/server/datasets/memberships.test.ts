import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { database } from "../infra/db/client";
import { inferenceOutcomes } from "../infra/db/schema";

import type { Worker } from "../../domain/workers/schema";
import { blobExists, requireBlob } from "../infra/blobs/store";
import { imageBlobKey } from "../images/keys";
import { contentDigest } from "../infra/digest";
import {
  addExperimentObservationImages,
  listDatasets,
  listDatasetsForModel,
  readDataset,
  removeDatasetImage,
} from "./memberships";

import { readAnnotation, storeAnnotation } from "../annotations/documents";

import { seedInferenceOutcome } from "../testing/inference";
import { listImageRecords } from "./records";
import { collectImages } from "../images/collection";

import { storeImage } from "../images/store";
import {
  testHeartbeat,
  FIXTURE_EDGE,
  imageBytes,
  imageDigest,
  observeImages,
  registerTrainedVersion,
  resultFor,
  uploadTexts,
} from "../testing/fixtures";
import { registerModel } from "../models/registry";

const worker: Worker = {
  ...testHeartbeat("worker"),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function readImageRecord(ref: { dataset: string; digest: string }) {
  return (
    (await listImageRecords(ref.dataset)).find(
      (record) => record.image.digest === ref.digest,
    ) ?? null
  );
}

/** The succeeded outcome stored for one image-version pair, if any. */
async function storedDetection(target: { versionId: string; digest: string }) {
  const db = await database();
  const [row] = await db
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
        eq(inferenceOutcomes.status, "succeeded"),
      ),
    );
  return row?.document ?? null;
}

describe("datasets", () => {
  test("a stored image belongs to nothing until an observation is submitted", async () => {
    const stored = await storeImage(await imageBytes("loose"));
    expect(stored).toEqual({
      digest: await imageDigest("loose"),
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      bytes: stored.bytes,
    });
    expect(await blobExists(imageBlobKey(stored.digest))).toBe(true);
    const { experiment } = await observeImages("loose images", ["loose-other"]);
    const missing = "11111111-1111-4111-8111-111111111111";
    await expect(
      addExperimentObservationImages({
        dataset: "loose",
        images: [{ experiment: experiment.id, observationImage: missing }],
      }),
    ).rejects.toThrow(
      `Not experiment observation images: ${experiment.id}/${missing}`,
    );
    expect(await readDataset("loose")).toBeNull();
  });

  test("adds experiment images under their source filenames", async () => {
    const { digests, images } = await observeImages("crop images", [
      "one",
      "two",
    ]);
    expect(
      await addExperimentObservationImages({ dataset: "crop", images }),
    ).toMatchObject({
      added: 2,
      existing: 0,
    });
    const listed = await listImageRecords("crop");
    expect(listed.map(({ image }) => image.digest).sort()).toEqual(
      [...digests].sort(),
    );
    expect(
      listed.find(({ image }) => image.filename === "two.jpg")?.image,
    ).toMatchObject({
      dataset: "crop",
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      split: null,
    });
    expect((await listDatasets()).map((dataset) => dataset.id)).toContain(
      "crop",
    );
    expect(await readDataset("crop")).toEqual({
      id: "crop",
      modelId: "seed-detector",
    });
    expect(
      await addExperimentObservationImages({
        dataset: "crop",
        images: [images[0]!],
      }),
    ).toMatchObject({ added: 0, existing: 1 });
  });

  test("a dataset trains the model that analyzed its experiment images", async () => {
    const seed = await observeImages("model images", ["modelled"]);
    await addExperimentObservationImages({
      dataset: "one-model",
      images: seed.images,
    });
    await registerModel({
      schemaVersion: 1,
      id: "other-task",
      name: "Other task",
      task: "object_detection",
      classes: ["seed"],
      metrics: [
        { id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] },
      ],
    });
    const otherVersion = await registerTrainedVersion("other-task");
    const other = await observeImages(
      "other images",
      ["modelled-elsewhere"],
      otherVersion,
    );
    await expect(
      addExperimentObservationImages({
        dataset: "one-model",
        images: other.images,
      }),
    ).rejects.toThrow(/trains seed-detector, not other-task/);
    await addExperimentObservationImages({
      dataset: "other-model",
      images: other.images,
    });
    const seedDatasets = (await listDatasetsForModel("seed-detector")).map(
      ({ id }) => id,
    );
    expect(seedDatasets).toContain("one-model");
    expect(seedDatasets).not.toContain("other-model");
    expect(
      (await listDatasetsForModel("other-task")).map(({ id }) => id),
    ).toContain("other-model");
    await expect(
      addExperimentObservationImages({
        dataset: "mixed",
        images: [...seed.images, ...other.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDataset("mixed")).toBeNull();

    const sameSeed = await observeImages(
      "same seed content",
      ["same-content"],
      seed.version,
    );
    const sameOther = await observeImages(
      "same other content",
      ["same-content"],
      otherVersion,
    );
    expect(sameSeed.digests).toEqual(sameOther.digests);
    await expect(
      addExperimentObservationImages({
        dataset: "mixed-same-content",
        images: [...sameSeed.images, ...sameOther.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDataset("mixed-same-content")).toBeNull();

    await expect(
      addExperimentObservationImages({
        dataset: "not a name",
        images: seed.images,
      }),
    ).rejects.toThrow(/Dataset names/);
  });

  test("one image can belong to several datasets", async () => {
    const { digests, images } = await observeImages("shared images", [
      "shared",
    ]);
    for (const dataset of ["left", "right"]) {
      await addExperimentObservationImages({ dataset, images });
    }
    const digest = digests[0]!;
    expect(
      (await readImageRecord({ dataset: "left", digest }))?.image.filename,
    ).toBe("shared.jpg");
    expect(
      (await readImageRecord({ dataset: "right", digest }))?.image.filename,
    ).toBe("shared.jpg");
    expect(contentDigest(await requireBlob(imageBlobKey(digest)))).toBe(digest);
  });

  test("a source that is not an image is not stored", async () => {
    await expect(storeImage(new TextEncoder().encode("notes"))).rejects.toThrow(
      /JPEG, PNG, or TIFF/,
    );
    await expect(storeImage(new Uint8Array())).rejects.toThrow(/empty/);
  });

  test("serializes concurrent additions to a new dataset", async () => {
    const a = await observeImages("concurrent a", ["concurrent-a"]);
    const b = await observeImages("concurrent b", ["concurrent-b"]);
    const [first, second] = await Promise.all([
      addExperimentObservationImages({
        dataset: "concurrent",
        images: a.images,
      }),
      addExperimentObservationImages({
        dataset: "concurrent",
        images: b.images,
      }),
    ]);
    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    expect(await listImageRecords("concurrent")).toHaveLength(2);
  });
});

describe("removal", () => {
  test("removes the membership; the review and the detection stay with the image", async () => {
    const { version, digests } = await uploadTexts("rm", ["rm-bytes"]);
    const digest = digests[0]!;
    const ref = { dataset: "rm", digest };
    const target = { versionId: version.id, digest };
    const result = await resultFor(version, "rm-bytes");
    await seedInferenceOutcome(target, result, worker);
    await storeAnnotation(
      { digest, modelId: version.modelId },
      instancesFromDetection(result),
      null,
    );

    await removeDatasetImage(ref);
    expect(await readImageRecord(ref)).toBeNull();
    expect(
      await readAnnotation({ digest, modelId: version.modelId }),
    ).not.toBeNull();
    expect(await storedDetection(target)).toEqual(result);
    await expect(removeDatasetImage(ref)).rejects.toThrow(/not in dataset/);
  });

  test("a review keeps the image alive after its last membership and observation are gone", async () => {
    const { digests, images } = await uploadTexts("share-a", ["shared-bytes"]);
    const digest = digests[0]!;
    await addExperimentObservationImages({ dataset: "share-b", images });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await removeDatasetImage({ dataset: "share-a", digest });
    expect(await collectImages(later)).not.toContain(digest);
    expect(
      await readImageRecord({ dataset: "share-b", digest }),
    ).not.toBeNull();
    await removeDatasetImage({ dataset: "share-b", digest });
    expect(await collectImages(later)).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });
});
