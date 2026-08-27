import { describe, expect, test } from "bun:test";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { InferenceWorkerRecord } from "../inference/workers";
import { blobExists, contentDigest, imageBlobKey, readBlob } from "./blobs";
import {
  findImage,
  listDatasets,
  listImages,
  readDataset,
  removeImage,
  selectModelVersion,
} from "./datasets";
import { createLabel, readLabel } from "./labels";
import { registerModelVersion, readModelVersion } from "./model-registry";
import {
  discardPrelabel,
  pendingImages,
  readPrelabel,
  writePrelabel,
} from "./prelabels";
import { readImageRecord, summarize } from "./summaries";
import { collectUnreferencedImages } from "./image-collection";
import {
  TEST_RUNTIME as runtime,
  imageBytes,
  imageDigest,
  imageFile,
  selectedVersion,
} from "./testing";
import { addImages } from "./upload";

async function workerFor(datasetId: string, workerId = `${datasetId}-worker`) {
  const { version } = await selectedVersion(datasetId);
  return {
    workerId,
    startedAt: "2026-08-27T00:00:00.000Z",
    deployment: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
    },
    runtime,
    current: null,
    lastSeenAt: "2026-08-27T00:00:00.000Z",
  } satisfies InferenceWorkerRecord;
}

function resultFor(digest: string, worker: InferenceWorkerRecord) {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], { digest }),
    producer: {
      model_version_id: worker.deployment.modelVersionId,
      artifact_digest: worker.deployment.artifactDigest,
      runtime: worker.runtime,
    },
  };
}

function nextTraditionalVersion(datasetId: string) {
  return registerModelVersion({
    schemaVersion: 1,
    id: `${datasetId}.traditional-v2`,
    modelId: datasetId,
    name: "Traditional vision v2",
    createdAt: "2026-08-27T01:00:00.000Z",
    source: { kind: "builtin", definition: "traditional-v2" },
    artifact: { kind: "traditional", digest: "c".repeat(64) },
  });
}

async function stateOf(ref: { dataset: string; digest: string }) {
  const record = await readImageRecord(ref);
  if (!record) throw new Error(`missing image ${ref.digest}`);
  return summarize(record).state;
}

describe("uploads", () => {
  test("creates a dataset-owned model and identifies images by content", async () => {
    const { added, existing } = await addImages("crop", [
      imageFile("one"),
      new File([imageBytes("two", ".png")], "two.jpg"),
    ]);
    expect(existing).toEqual([]);
    expect(added.map((image) => image.digest)).toEqual([
      imageDigest("one"),
      contentDigest(imageBytes("two", ".png")),
    ]);
    expect(added[1]).toMatchObject({
      dataset: "crop",
      filename: "two.jpg",
      extension: ".png",
      bytes: imageBytes("two", ".png").byteLength,
      split: null,
    });
    expect(await listDatasets()).toContain("crop");
    expect(await readDataset("crop")).toEqual({
      schemaVersion: 1,
      id: "crop",
      modelId: "crop",
      selectedModelVersionId: "crop.traditional-v1",
    });
    expect((await readModelVersion("crop.traditional-v1"))?.modelId).toBe(
      "crop",
    );

    await expect(
      addImages("crop", [new File(["x"], "notes.jpg")]),
    ).rejects.toThrow(/Unsupported image content/);
    expect(await listImages("crop")).toHaveLength(2);
  });

  test("the same bytes are one image, whatever they are called", async () => {
    const first = await addImages("same", [imageFile("pixels", "a.jpg")]);
    const again = await addImages("same", [
      imageFile("pixels", "b.jpg"),
      imageFile("pixels", "c.jpg"),
    ]);
    expect(again).toEqual({ added: [], existing: first.added });
    expect(await listImages("same")).toHaveLength(1);
    expect(
      (await findImage({ dataset: "same", digest: imageDigest("pixels") }))
        ?.filename,
    ).toBe("a.jpg");
  });

  test("one image can belong to several datasets under its own name in each", async () => {
    await addImages("left", [imageFile("shared", "shared.jpg")]);
    await addImages("right", [imageFile("shared", "renamed.jpg")]);
    const digest = imageDigest("shared");
    expect((await findImage({ dataset: "left", digest }))?.filename).toBe(
      "shared.jpg",
    );
    expect((await findImage({ dataset: "right", digest }))?.filename).toBe(
      "renamed.jpg",
    );
    expect(readBlob(imageBlobKey(digest))).toEqual(imageBytes("shared"));
  });

  test("writes nothing when any file in the batch is invalid", async () => {
    await expect(
      addImages("atomic", [
        imageFile("x", "ok.jpg"),
        imageFile("y", "../up.jpg"),
      ]),
    ).rejects.toThrow();
    expect(await readDataset("atomic")).toBeNull();
    expect(blobExists(imageBlobKey(imageDigest("x")))).toBe(false);
  });

  test("serializes concurrent uploads into a new dataset", async () => {
    const [first, second] = await Promise.all([
      addImages("concurrent-upload", [imageFile("a")]),
      addImages("concurrent-upload", [imageFile("b")]),
    ]);
    expect(first.added[0]?.digest).toBe(imageDigest("a"));
    expect(second.added[0]?.digest).toBe(imageDigest("b"));
    expect(await listImages("concurrent-upload")).toHaveLength(2);
  });
});

describe("prelabels", () => {
  test("a dataset assigns work only to its selected model version", async () => {
    await addImages("pend", [imageFile("a", "a.jpg"), imageFile("b", "b.jpg")]);
    const worker = await workerFor("pend");
    const a = { dataset: "pend", digest: imageDigest("a") };
    const b = { dataset: "pend", digest: imageDigest("b") };
    const pending = async (deployment: InferenceWorkerRecord["deployment"]) =>
      (await pendingImages(deployment)).map((image) => image.filename);
    expect(await pending(worker.deployment)).toEqual(["a.jpg", "b.jpg"]);

    await writePrelabel(a, resultFor(a.digest, worker), worker);
    expect(await stateOf(a)).toBe("prelabeled");
    const failure = {
      schema_version: 1,
      image: { digest: b.digest },
      producer: resultFor(b.digest, worker).producer,
      error: "boom",
    };
    await writePrelabel(b, failure, worker);
    expect(await stateOf(b)).toBe("failed");
    await discardPrelabel(b);
    expect(await pending(worker.deployment)).toEqual(["b.jpg"]);

    const next = await nextTraditionalVersion("pend");
    await selectModelVersion("pend", next.id);
    const nextWorker = await workerFor("pend", "pend-next-worker");
    expect(await pending(nextWorker.deployment)).toEqual(["a.jpg", "b.jpg"]);
    await expect(
      writePrelabel(b, resultFor(b.digest, worker), worker),
    ).rejects.toThrow(/assigned to another model version/);
  });

  test("a prelabel must describe the image it is stored under", async () => {
    await addImages("mismatch", [imageFile("a", "a.jpg")]);
    const worker = await workerFor("mismatch");
    const ref = { dataset: "mismatch", digest: imageDigest("a") };
    await expect(
      writePrelabel(ref, resultFor(imageDigest("b"), worker), worker),
    ).rejects.toThrow(/describes/);
  });

  test("freezes a prelabel after review begins", async () => {
    await addImages("frozen", [imageFile("a", "a.jpg")]);
    const ref = { dataset: "frozen", digest: imageDigest("a") };
    const worker = await workerFor("frozen");
    const original = await writePrelabel(
      ref,
      resultFor(ref.digest, worker),
      worker,
    );
    if ("error" in original) throw new Error("unexpected failure document");
    await createLabel(ref, documentFromPrelabel(original));

    await selectModelVersion(
      "frozen",
      (await nextTraditionalVersion("frozen")).id,
    );
    await expect(discardPrelabel(ref)).rejects.toThrow(/frozen/);
    expect(await readPrelabel(ref)).toEqual(original);
    expect(await stateOf(ref)).toBe("in_progress");
  });

  test("review state is per dataset", async () => {
    await addImages("ctx-one", [imageFile("ctx", "ctx.jpg")]);
    await addImages("ctx-two", [imageFile("ctx", "ctx.jpg")]);
    const digest = imageDigest("ctx");
    const worker = await workerFor("ctx-one");
    await writePrelabel(
      { dataset: "ctx-one", digest },
      resultFor(digest, worker),
      worker,
    );
    expect(await stateOf({ dataset: "ctx-one", digest })).toBe("prelabeled");
    expect(await stateOf({ dataset: "ctx-two", digest })).toBe("pending");
  });
});

describe("removal", () => {
  test("removes the membership with its prelabel and label", async () => {
    await addImages("rm", [imageFile("rm-bytes", "a.jpg")]);
    const ref = { dataset: "rm", digest: imageDigest("rm-bytes") };
    const worker = await workerFor("rm");
    const prelabel = await writePrelabel(
      ref,
      resultFor(ref.digest, worker),
      worker,
    );
    if ("error" in prelabel) throw new Error("unexpected failure document");
    await createLabel(ref, documentFromPrelabel(prelabel));

    await removeImage(ref);
    expect(await findImage(ref)).toBeNull();
    expect(await readPrelabel(ref)).toBeNull();
    expect(await readLabel(ref)).toBeNull();
    await expect(removeImage(ref)).rejects.toThrow(/not in dataset/);
  });

  test("bytes outlive their last reference until collected", async () => {
    await addImages("share-a", [imageFile("shared-bytes", "first.jpg")]);
    await addImages("share-b", [imageFile("shared-bytes", "second.jpg")]);
    const digest = imageDigest("shared-bytes");
    await removeImage({ dataset: "share-a", digest });
    expect(await collectUnreferencedImages()).not.toContain(digest);
    expect(await findImage({ dataset: "share-b", digest })).not.toBeNull();
    await removeImage({ dataset: "share-b", digest });
    expect(blobExists(imageBlobKey(digest))).toBe(true);
    expect(await collectUnreferencedImages()).toContain(digest);
    expect(blobExists(imageBlobKey(digest))).toBe(false);

    const { added } = await addImages("share-c", [
      imageFile("shared-bytes", "third.jpg"),
    ]);
    expect(added.map((image) => image.digest)).toEqual([digest]);
    expect(readBlob(imageBlobKey(digest))).toEqual(imageBytes("shared-bytes"));
  });
});
