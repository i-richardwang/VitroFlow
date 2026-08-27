import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { InferenceWorkerRecord } from "../inference/workers";
import { blobExists, imageBlobKey, readBlob } from "./blobs";
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
import { addImages } from "./upload";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const runtime = {
  adapter: "traditional" as const,
  fingerprint: "b".repeat(64),
};

async function workerFor(datasetId: string, workerId = `${datasetId}-worker`) {
  const dataset = await readDataset(datasetId);
  if (!dataset) throw new Error("missing dataset");
  const version = await readModelVersion(dataset.selectedModelVersionId);
  if (!version) throw new Error("missing version");
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

function resultFor(source: string, worker: InferenceWorkerRecord) {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }]),
    source,
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

async function stateOf(ref: { dataset: string; stem: string }) {
  const record = await readImageRecord(ref);
  if (!record) throw new Error(`missing image ${ref.stem}`);
  return summarize(record).state;
}

describe("uploads", () => {
  test("creates a dataset-owned model and rejects duplicate stems", async () => {
    const added = await addImages("crop", [
      new File(["one"], "one.jpg"),
      new File(["two"], "two.PNG"),
    ]);
    expect(added.map((image) => image.stem)).toEqual(["one", "two"]);
    expect(added[1]?.source).toBe("images/crop/two.png");
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
      addImages("crop", [new File(["x"], "ONE.tif")]),
    ).rejects.toThrow(/already in dataset/);
    await expect(
      addImages("crop", [new File(["x"], "a.jpg"), new File(["y"], "a.png")]),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      addImages("crop", [new File(["x"], "notes.txt")]),
    ).rejects.toThrow(/Unsupported/);
    expect(await listImages("crop")).toHaveLength(2);
  });

  test("writes nothing when any file in the batch is invalid", async () => {
    await expect(
      addImages("atomic", [
        new File(["x"], "ok.jpg"),
        new File(["y"], "../up.jpg"),
      ]),
    ).rejects.toThrow();
    expect(await readDataset("atomic")).toBeNull();
    expect(blobExists(imageBlobKey(sha256("x")))).toBe(false);
  });

  test("serializes concurrent uploads into a new dataset", async () => {
    const [first, second] = await Promise.all([
      addImages("concurrent-upload", [new File(["a"], "a.jpg")]),
      addImages("concurrent-upload", [new File(["b"], "b.jpg")]),
    ]);
    expect(first[0]?.stem).toBe("a");
    expect(second[0]?.stem).toBe("b");
    expect(
      (await listImages("concurrent-upload")).map(({ stem }) => stem),
    ).toEqual(["a", "b"]);
  });

  test("a rejected duplicate leaves the existing image's bytes untouched", async () => {
    const [original] = await addImages("keep", [
      new File(["original"], "one.jpg"),
    ]);
    if (!original) throw new Error("missing upload");
    await expect(
      addImages("keep", [new File(["replacement"], "one.jpg")]),
    ).rejects.toThrow(/already in dataset/);
    expect(blobExists(original.blobKey)).toBe(true);
    expect(blobExists(imageBlobKey(sha256("replacement")))).toBe(false);
    expect(new TextDecoder().decode(readBlob(original.blobKey))).toBe(
      "original",
    );
  });
});

describe("prelabels", () => {
  test("a dataset assigns work only to its selected model version", async () => {
    await addImages("pend", [
      new File(["a"], "a.jpg"),
      new File(["b"], "b.jpg"),
    ]);
    const worker = await workerFor("pend");
    const a = { dataset: "pend", stem: "a" };
    const b = { dataset: "pend", stem: "b" };
    const pending = async (deployment: InferenceWorkerRecord["deployment"]) =>
      (await pendingImages(deployment)).map((image) => image.stem);
    expect(await pending(worker.deployment)).toEqual(["a", "b"]);

    await writePrelabel(a, resultFor("images/pend/a.jpg", worker), worker);
    expect(await stateOf(a)).toBe("prelabeled");
    const failure = {
      schema_version: 2,
      source: "images/pend/b.jpg",
      producer: resultFor("images/pend/b.jpg", worker).producer,
      error: "boom",
    };
    await writePrelabel(b, failure, worker);
    expect(await stateOf(b)).toBe("failed");
    await discardPrelabel(b);
    expect(await pending(worker.deployment)).toEqual(["b"]);

    const next = await nextTraditionalVersion("pend");
    await selectModelVersion("pend", next.id);
    const nextWorker = await workerFor("pend", "pend-next-worker");
    expect(await pending(nextWorker.deployment)).toEqual(["a", "b"]);
    await expect(
      writePrelabel(b, resultFor("images/pend/b.jpg", worker), worker),
    ).rejects.toThrow(/assigned to another model version/);
  });

  test("freezes a prelabel after review begins", async () => {
    await addImages("frozen", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "frozen", stem: "a" };
    const worker = await workerFor("frozen");
    const original = await writePrelabel(
      ref,
      resultFor("images/frozen/a.jpg", worker),
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
});

describe("removal", () => {
  test("deletes the image with its prelabel and label", async () => {
    await addImages("rm", [new File(["rm-bytes"], "a.jpg")]);
    const ref = { dataset: "rm", stem: "a" };
    const worker = await workerFor("rm");
    const prelabel = await writePrelabel(
      ref,
      resultFor("images/rm/a.jpg", worker),
      worker,
    );
    if ("error" in prelabel) throw new Error("unexpected failure document");
    await createLabel(ref, documentFromPrelabel(prelabel));

    await removeImage(ref);
    expect(await findImage(ref)).toBeNull();
    expect(await readPrelabel(ref)).toBeNull();
    expect(await readLabel(ref)).toBeNull();
    expect(blobExists(imageBlobKey(sha256("rm-bytes")))).toBe(false);
  });

  test("bytes shared with another image survive the removal", async () => {
    await addImages("share", [
      new File(["same"], "first.jpg"),
      new File(["same"], "second.jpg"),
    ]);
    const key = imageBlobKey(sha256("same"));
    await removeImage({ dataset: "share", stem: "first" });
    expect(blobExists(key)).toBe(true);
    await removeImage({ dataset: "share", stem: "second" });
    expect(blobExists(key)).toBe(false);
  });
});
