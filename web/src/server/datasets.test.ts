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
  pendingAssignments,
  readPrelabel,
  writePrelabel,
} from "./prelabels";
import { readImageRecord, summarize } from "./summaries";
import { collectUnreferencedImages } from "./image-collection";
import {
  TEST_RUNTIME as runtime,
  testHeartbeat,
  FIXTURE_EDGE,
  imageBytes,
  imageDigest,
  imageSource,
  selectedVersion,
} from "./testing";
import { addImage } from "./upload";

const worker: InferenceWorkerRecord = {
  ...testHeartbeat("worker"),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

/** A result from the version `datasetId` currently selects. */
async function resultFor(datasetId: string, digest: string) {
  const { version } = await selectedVersion(datasetId);
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest,
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime,
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
    const one = await addImage("crop", await imageSource("one"));
    const two = await addImage("crop", {
      filename: "two.jpg",
      bytes: await imageBytes("two"),
    });
    expect([one.added, two.added]).toEqual([true, true]);
    expect([one.image.digest, two.image.digest]).toEqual([
      await imageDigest("one"),
      await imageDigest("two"),
    ]);
    expect(two.image).toMatchObject({
      dataset: "crop",
      filename: "two.jpg",
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
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
  });

  test("the same bytes are one image, whatever they are called", async () => {
    const first = await addImage("same", await imageSource("pixels", "a.jpg"));
    const again = await addImage("same", await imageSource("pixels", "b.jpg"));
    expect(again).toEqual({ image: first.image, added: false });
    expect(await listImages("same")).toHaveLength(1);
    expect(first.image.filename).toBe("a.jpg");
  });

  test("one image can belong to several datasets under its own name in each", async () => {
    await addImage("left", await imageSource("shared", "shared.jpg"));
    await addImage("right", await imageSource("shared", "renamed.jpg"));
    const digest = await imageDigest("shared");
    expect((await findImage({ dataset: "left", digest }))?.filename).toBe(
      "shared.jpg",
    );
    expect((await findImage({ dataset: "right", digest }))?.filename).toBe(
      "renamed.jpg",
    );
    expect(contentDigest(readBlob(imageBlobKey(digest)))).toBe(digest);
  });

  test("a source that is not a photograph writes nothing", async () => {
    await expect(
      addImage("rejected", {
        filename: "notes.jpg",
        bytes: new TextEncoder().encode("x"),
      }),
    ).rejects.toThrow(/notes\.jpg/);
    await expect(
      addImage("rejected", await imageSource("y", "../up.jpg")),
    ).rejects.toThrow(/filename/);
    await expect(
      addImage("rejected", await imageSource("y", "..\\up.jpg")),
    ).rejects.toThrow(/filename/);
    expect(await readDataset("rejected")).toBeNull();
    expect(blobExists(imageBlobKey(await imageDigest("y")))).toBe(false);
  });

  test("serializes concurrent uploads into a new dataset", async () => {
    const [first, second] = await Promise.all([
      addImage("concurrent-upload", await imageSource("a")),
      addImage("concurrent-upload", await imageSource("b")),
    ]);
    expect(first.image.digest).toBe(await imageDigest("a"));
    expect(second.image.digest).toBe(await imageDigest("b"));
    expect(await listImages("concurrent-upload")).toHaveLength(2);
  });
});

describe("prelabels", () => {
  test("a dataset assigns work only to its selected model version", async () => {
    await addImage("pend", await imageSource("a", "a.jpg"));
    await addImage("pend", await imageSource("b", "b.jpg"));
    const a = { dataset: "pend", digest: await imageDigest("a") };
    const b = { dataset: "pend", digest: await imageDigest("b") };
    const pending = async () =>
      (await pendingAssignments(worker)).flatMap((assignment) => {
        const images = assignment.images.filter(
          (image) => image.dataset === "pend",
        );
        return images.length
          ? [
              [
                assignment.manifest.modelVersionId,
                images.map((i) => i.filename),
              ],
            ]
          : [];
      });
    const { version } = await selectedVersion("pend");
    expect(await pending()).toEqual([[version.id, ["a.jpg", "b.jpg"]]]);
    const original = await resultFor("pend", b.digest);

    await writePrelabel(a, await resultFor("pend", a.digest), worker);
    expect(await stateOf(a)).toBe("prelabeled");
    const failure = {
      schema_version: 1,
      image: { digest: b.digest },
      producer: original.producer,
      error: "boom",
    };
    await writePrelabel(b, failure, worker);
    expect(await stateOf(b)).toBe("failed");
    await discardPrelabel(b);
    expect(await pending()).toEqual([[version.id, ["b.jpg"]]]);

    const next = await nextTraditionalVersion("pend");
    await selectModelVersion("pend", next.id);
    expect(await pending()).toEqual([[next.id, ["a.jpg", "b.jpg"]]]);
    await expect(writePrelabel(b, original, worker)).rejects.toThrow(
      /assigned to another model version/,
    );
    expect(
      await pendingAssignments({
        runtimes: [{ adapter: "ultralytics", fingerprint: "c".repeat(64) }],
      }),
    ).toEqual([]);
  });

  test("a prelabel must describe the image it is stored under", async () => {
    await addImage("mismatch", await imageSource("a", "a.jpg"));
    const ref = { dataset: "mismatch", digest: await imageDigest("a") };
    await expect(
      writePrelabel(
        ref,
        await resultFor("mismatch", await imageDigest("b")),
        worker,
      ),
    ).rejects.toThrow(/describes/);

    const wrongSize = await resultFor("mismatch", ref.digest);
    await expect(
      writePrelabel(
        ref,
        {
          ...wrongSize,
          image: { digest: ref.digest, width: 1, height: 1 },
          instances: [],
        },
        worker,
      ),
    ).rejects.toThrow(/1x1/);
  });

  test("freezes a prelabel after review begins", async () => {
    await addImage("frozen", await imageSource("a", "a.jpg"));
    const ref = { dataset: "frozen", digest: await imageDigest("a") };
    const original = await writePrelabel(
      ref,
      await resultFor("frozen", ref.digest),
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
    await addImage("ctx-one", await imageSource("ctx", "ctx.jpg"));
    await addImage("ctx-two", await imageSource("ctx", "ctx.jpg"));
    const digest = await imageDigest("ctx");
    await writePrelabel(
      { dataset: "ctx-one", digest },
      await resultFor("ctx-one", digest),
      worker,
    );
    expect(await stateOf({ dataset: "ctx-one", digest })).toBe("prelabeled");
    expect(await stateOf({ dataset: "ctx-two", digest })).toBe("pending");
  });
});

describe("removal", () => {
  test("removes the membership with its prelabel and label", async () => {
    await addImage("rm", await imageSource("rm-bytes", "a.jpg"));
    const ref = { dataset: "rm", digest: await imageDigest("rm-bytes") };
    const prelabel = await writePrelabel(
      ref,
      await resultFor("rm", ref.digest),
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
    await addImage("share-a", await imageSource("shared-bytes", "first.jpg"));
    await addImage("share-b", await imageSource("shared-bytes", "second.jpg"));
    const digest = await imageDigest("shared-bytes");
    await removeImage({ dataset: "share-a", digest });
    expect(await collectUnreferencedImages()).not.toContain(digest);
    expect(await findImage({ dataset: "share-b", digest })).not.toBeNull();
    await removeImage({ dataset: "share-b", digest });
    expect(blobExists(imageBlobKey(digest))).toBe(true);
    expect(await collectUnreferencedImages()).toContain(digest);
    expect(blobExists(imageBlobKey(digest))).toBe(false);

    const { image } = await addImage(
      "share-c",
      await imageSource("shared-bytes", "third.jpg"),
    );
    expect(image.digest).toBe(digest);
    expect(contentDigest(readBlob(imageBlobKey(digest)))).toBe(digest);
  });
});
