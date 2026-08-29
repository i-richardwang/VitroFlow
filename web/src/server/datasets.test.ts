import { describe, expect, test } from "bun:test";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { InferenceWorkerRecord } from "../inference/workers";
import {
  blobExists,
  contentDigest,
  imageBlobKey,
  putImmutableBlob,
  requireBlob,
} from "./blobs";
import {
  claimImages,
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
import { collectImages } from "./image-collection";
import { canonicalize } from "./image-ingest";
import { storeImage } from "./image-store";
import {
  TEST_RUNTIME as runtime,
  testHeartbeat,
  FIXTURE_EDGE,
  imageBytes,
  imageDigest,
  imageSource,
  selectedVersion,
  uploadSources,
} from "./testing";

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
  test("stores a photograph before any dataset claims it", async () => {
    const stored = await storeImage(await imageBytes("loose"));
    expect(stored).toEqual({
      digest: await imageDigest("loose"),
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      bytes: stored.bytes,
    });
    expect(await blobExists(imageBlobKey(stored.digest))).toBe(true);
    expect(await listDatasets()).not.toContain("loose");
  });

  test("creates a dataset-owned model and identifies images by content", async () => {
    expect(
      await uploadSources("crop", [
        await imageSource("one"),
        { filename: "two.jpg", bytes: await imageBytes("two") },
      ]),
    ).toEqual({ added: 2, existing: 0 });
    const listed = await listImages("crop");
    expect(listed.map((image) => image.digest).sort()).toEqual(
      [await imageDigest("one"), await imageDigest("two")].sort(),
    );
    expect(listed.find((image) => image.filename === "two.jpg")).toMatchObject({
      dataset: "crop",
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
    const { added } = await uploadSources("same", [
      await imageSource("pixels", "a.jpg"),
      await imageSource("pixels", "b.jpg"),
    ]);
    expect(added).toBe(1);
    const listed = await listImages("same");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.filename).toBe("a.jpg");

    const again = await uploadSources("same", [
      await imageSource("pixels", "c.jpg"),
    ]);
    expect(again.added).toBe(0);
    expect((await listImages("same"))[0]?.filename).toBe("a.jpg");
  });

  test("one image can belong to several datasets under its own name in each", async () => {
    await uploadSources("left", [await imageSource("shared", "shared.jpg")]);
    await uploadSources("right", [await imageSource("shared", "renamed.jpg")]);
    const digest = await imageDigest("shared");
    expect((await findImage({ dataset: "left", digest }))?.filename).toBe(
      "shared.jpg",
    );
    expect((await findImage({ dataset: "right", digest }))?.filename).toBe(
      "renamed.jpg",
    );
    expect(contentDigest(await requireBlob(imageBlobKey(digest)))).toBe(digest);
  });

  test("a source that is not a photograph is not stored", async () => {
    await expect(storeImage(new TextEncoder().encode("notes"))).rejects.toThrow(
      /JPEG, PNG, or TIFF/,
    );
    await expect(storeImage(new Uint8Array())).rejects.toThrow(/empty/);
  });

  test("a dataset gains the whole set or none of it", async () => {
    const stored = await storeImage(await imageBytes("rejected"));
    await expect(
      claimImages({
        dataset: "rejected",
        images: [
          { digest: stored.digest, filename: "fine.jpg" },
          { digest: stored.digest, filename: "../up.jpg" },
        ],
      }),
    ).rejects.toThrow(/filename/);
    await expect(
      claimImages({
        dataset: "not a name",
        images: [{ digest: stored.digest, filename: "fine.jpg" }],
      }),
    ).rejects.toThrow(/Dataset names/);
    expect(await readDataset("rejected")).toBeNull();
  });

  test("images must still be stored when they are claimed", async () => {
    await expect(
      claimImages({
        dataset: "gone",
        images: [{ digest: "a".repeat(64), filename: "a.jpg" }],
      }),
    ).rejects.toThrow(/no longer stored/);
  });

  test("serializes concurrent uploads into a new dataset", async () => {
    const [first, second] = await Promise.all([
      uploadSources("concurrent-upload", [await imageSource("a")]),
      uploadSources("concurrent-upload", [await imageSource("b")]),
    ]);
    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    expect(await listImages("concurrent-upload")).toHaveLength(2);
  });
});

describe("collection", () => {
  /** A moment past the period an unclaimed photograph is kept for. */
  const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

  test("keeps unclaimed bytes while a dataset is still being chosen", async () => {
    const { digest } = await storeImage(await imageBytes("waiting"));
    expect(await collectImages()).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });

  test("collects photographs nobody claimed", async () => {
    const { digest } = await storeImage(await imageBytes("abandoned"));
    expect(await collectImages(later())).toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(false);
  });

  test("claiming a photograph keeps it", async () => {
    await uploadSources("claimed", [await imageSource("kept", "kept.jpg")]);
    const digest = await imageDigest("kept");
    expect(await collectImages(later())).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });

  test("collects an immutable object whose Image transaction never committed", async () => {
    const orphan = await canonicalize(await imageBytes("orphan"));
    await putImmutableBlob(imageBlobKey(orphan.digest), orphan.bytes);

    expect(await collectImages()).toContain(orphan.digest);
    expect(await blobExists(imageBlobKey(orphan.digest))).toBe(false);
  });
});

describe("prelabels", () => {
  test("a dataset assigns work only to its selected model version", async () => {
    await uploadSources("pend", [await imageSource("a", "a.jpg")]);
    await uploadSources("pend", [await imageSource("b", "b.jpg")]);
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
    await uploadSources("mismatch", [await imageSource("a", "a.jpg")]);
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
    await uploadSources("frozen", [await imageSource("a", "a.jpg")]);
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
    await uploadSources("ctx-one", [await imageSource("ctx", "ctx.jpg")]);
    await uploadSources("ctx-two", [await imageSource("ctx", "ctx.jpg")]);
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
    await uploadSources("rm", [await imageSource("rm-bytes", "a.jpg")]);
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
    await uploadSources("share-a", [
      await imageSource("shared-bytes", "first.jpg"),
    ]);
    await uploadSources("share-b", [
      await imageSource("shared-bytes", "second.jpg"),
    ]);
    const digest = await imageDigest("shared-bytes");
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await removeImage({ dataset: "share-a", digest });
    expect(await collectImages(later)).not.toContain(digest);
    expect(await findImage({ dataset: "share-b", digest })).not.toBeNull();
    await removeImage({ dataset: "share-b", digest });
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
    expect(await collectImages(later)).toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(false);

    await uploadSources("share-c", [
      await imageSource("shared-bytes", "third.jpg"),
    ]);
    expect((await listImages("share-c"))[0]?.digest).toBe(digest);
    expect(contentDigest(await requireBlob(imageBlobKey(digest)))).toBe(digest);
  });
});
