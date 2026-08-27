import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { InferenceWorkerRecord } from "../inference/workers";
import {
  findImage,
  listDatasets,
  listImages,
  readDataset,
  removeImage,
  selectModelVersion,
} from "./datasets";
import { createLabel } from "./labels";
import { registerModelVersion, readModelVersion } from "./model-registry";
import { DATA_ROOT } from "./paths";
import {
  discardPrelabel,
  pendingImages,
  readPrelabel,
  writePrelabel,
} from "./prelabels";
import { summarizeImage } from "./summaries";
import { addImages } from "./upload";

const runtime = {
  adapter: "traditional" as const,
  fingerprint: "b".repeat(64),
};

function workerFor(datasetId: string, workerId = `${datasetId}-worker`) {
  const dataset = readDataset(datasetId);
  if (!dataset) throw new Error("missing dataset");
  const version = readModelVersion(dataset.selectedModelVersionId);
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

describe("uploads", () => {
  test("creates a dataset-owned model and rejects duplicate stems", async () => {
    const added = await addImages("crop", [
      new File(["one"], "one.jpg"),
      new File(["two"], "two.PNG"),
    ]);
    expect(added.map((image) => image.stem)).toEqual(["one", "two"]);
    expect(listDatasets()).toContain("crop");
    expect(readDataset("crop")).toEqual({
      schemaVersion: 1,
      id: "crop",
      modelId: "crop",
      selectedModelVersionId: "crop.traditional-v1",
    });
    expect(readModelVersion("crop.traditional-v1")?.modelId).toBe("crop");

    await expect(
      addImages("crop", [new File(["x"], "ONE.tif")]),
    ).rejects.toThrow(/already in dataset/);
    await expect(
      addImages("crop", [new File(["x"], "a.jpg"), new File(["y"], "a.png")]),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      addImages("crop", [new File(["x"], "notes.txt")]),
    ).rejects.toThrow(/Unsupported/);
    expect(listImages("crop")).toHaveLength(2);
  });

  test("writes nothing when any file in the batch is invalid", async () => {
    await expect(
      addImages("atomic", [
        new File(["x"], "ok.jpg"),
        new File(["y"], "../up.jpg"),
      ]),
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(DATA_ROOT, "images", "atomic"))).toBe(false);
  });
});

describe("prelabels", () => {
  test("a dataset assigns work only to its selected model version", async () => {
    await addImages("pend", [
      new File(["a"], "a.jpg"),
      new File(["b"], "b.jpg"),
    ]);
    const worker = workerFor("pend");
    const a = { dataset: "pend", stem: "a" };
    const b = { dataset: "pend", stem: "b" };
    expect(pendingImages(worker.deployment).map((image) => image.stem)).toEqual([
      "a",
      "b",
    ]);

    writePrelabel(a, resultFor("images/pend/a.jpg", worker), worker);
    expect(summarizeImage(a).state).toBe("prelabeled");
    const failure = {
      schema_version: 2,
      source: "images/pend/b.jpg",
      producer: resultFor("images/pend/b.jpg", worker).producer,
      error: "boom",
    };
    writePrelabel(b, failure, worker);
    expect(summarizeImage(b).state).toBe("failed");
    discardPrelabel(b);
    expect(pendingImages(worker.deployment).map((image) => image.stem)).toEqual(["b"]);

    const next = nextTraditionalVersion("pend");
    selectModelVersion("pend", next.id);
    const nextWorker = workerFor("pend", "pend-next-worker");
    expect(pendingImages(nextWorker.deployment).map((image) => image.stem)).toEqual([
      "a",
      "b",
    ]);
    expect(() =>
      writePrelabel(b, resultFor("images/pend/b.jpg", worker), worker),
    ).toThrow(/assigned to another model version/);
  });

  test("freezes a prelabel after review begins", async () => {
    await addImages("frozen", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "frozen", stem: "a" };
    const worker = workerFor("frozen");
    const original = writePrelabel(
      ref,
      resultFor("images/frozen/a.jpg", worker),
      worker,
    );
    if ("error" in original) throw new Error("unexpected failure document");
    createLabel(ref, documentFromPrelabel(original));

    selectModelVersion("frozen", nextTraditionalVersion("frozen").id);
    expect(() => discardPrelabel(ref)).toThrow(/frozen/);
    expect(readPrelabel(ref)).toEqual(original);
    expect(summarizeImage(ref).state).toBe("in_progress");
  });
});

describe("removal", () => {
  test("deletes the image with its prelabel and label", async () => {
    await addImages("rm", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "rm", stem: "a" };
    const worker = workerFor("rm");
    const prelabel = writePrelabel(ref, resultFor("images/rm/a.jpg", worker), worker);
    if ("error" in prelabel) throw new Error("unexpected failure document");
    createLabel(ref, documentFromPrelabel(prelabel));

    removeImage(ref);
    expect(findImage(ref)).toBeNull();
    expect(readPrelabel(ref)).toBeNull();
    expect(fs.existsSync(path.join(DATA_ROOT, "labels", "rm", "a.json"))).toBe(false);
  });
});
