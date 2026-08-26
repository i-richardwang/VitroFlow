import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import {
  findImage,
  listDatasets,
  listImages,
  readDataset,
  removeImage,
  selectModelVersion,
} from "./datasets";
import { summarizeImage } from "./summaries";
import { createLabel } from "./labels";
import { DATA_ROOT } from "./paths";
import {
  DEFAULT_MODEL,
  ensureDefaultModel,
  registerModel,
  registerModelVersion,
} from "./model-registry";
import {
  discardPrelabel,
  pendingImages,
  readPrelabel,
  writePrelabel,
} from "./prelabels";
import { addImages } from "./upload";

const prelabeler = {
  version_id: "traditional-v1",
  name: "m",
  kind: "traditional",
  fingerprint: "b".repeat(64),
};

const nextPrelabeler = {
  ...prelabeler,
  version_id: "traditional-next",
  name: "next",
  fingerprint: "c".repeat(64),
};

function resultFor(source: string) {
  return { ...makeResult([{ id: 0, x: 10, y: 10 }]), source };
}

function pending() {
  ensureDefaultModel();
  registerModelVersion(DEFAULT_MODEL.id, prelabeler);
  return pendingImages(prelabeler).map(
    (image) => `${image.dataset}/${image.stem}`,
  );
}

describe("uploads", () => {
  test("adds images to a dataset and rejects duplicate stems", async () => {
    const added = await addImages("crop", [
      new File(["one"], "one.jpg"),
      new File(["two"], "two.PNG"),
    ]);
    expect(added.map((image) => image.stem)).toEqual(["one", "two"]);
    expect(listDatasets()).toContain("crop");
    expect(readDataset("crop")).toEqual({
      schemaVersion: 1,
      id: "crop",
      modelId: "seed-detector",
      selectedModelVersionId: "traditional-v1",
    });
    expect(listImages("crop").map((image) => image.source)).toEqual([
      "images/crop/one.jpg",
      "images/crop/two.PNG",
    ]);

    await expect(
      addImages("crop", [new File(["x"], "ONE.tif")]),
    ).rejects.toThrow(/already in dataset/);
    await expect(
      addImages("crop", [new File(["x"], "a.jpg"), new File(["y"], "a.png")]),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      addImages("crop", [new File(["x"], "notes.txt")]),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      addImages("bad name", [new File(["x"], "a.jpg")]),
    ).rejects.toThrow(/Dataset names/);
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
  test("datasets assign work only to their selected version", async () => {
    ensureDefaultModel();
    registerModelVersion(DEFAULT_MODEL.id, prelabeler);
    registerModelVersion(DEFAULT_MODEL.id, nextPrelabeler);
    await addImages("pend", [
      new File(["a"], "a.jpg"),
      new File(["b"], "b.jpg"),
    ]);
    const a = { dataset: "pend", stem: "a" };
    const b = { dataset: "pend", stem: "b" };
    expect(pending()).toEqual(expect.arrayContaining(["pend/a", "pend/b"]));

    writePrelabel(a, resultFor("images/pend/a.jpg"));
    expect(pending()).not.toContain("pend/a");
    expect(summarizeImage(a).state).toBe("prelabeled");

    const { producer } = resultFor("images/pend/b.jpg");
    writePrelabel(b, {
      schema_version: 1,
      source: "images/pend/b.jpg",
      error: "boom",
      producer,
    });
    expect(summarizeImage(b).state).toBe("failed");
    expect(summarizeImage(b).error).toBe("boom");
    expect(pending()).not.toContain("pend/b");

    discardPrelabel(b);
    expect(pending()).toContain("pend/b");

    expect(pendingImages(nextPrelabeler).map((i) => i.dataset)).not.toContain(
      "pend",
    );
    selectModelVersion("pend", nextPrelabeler.version_id);
    expect(pendingImages(nextPrelabeler).map((i) => i.stem)).toEqual(["a", "b"]);
    expect(pending()).not.toContain("pend/a");
    expect(() =>
      writePrelabel(b, resultFor("images/pend/b.jpg")),
    ).toThrow(/assigned to another model version/);
  });

  test("rejects documents for unknown images or mismatched sources", async () => {
    ensureDefaultModel();
    registerModelVersion(DEFAULT_MODEL.id, prelabeler);
    await addImages("src", [new File(["a"], "a.jpg")]);
    expect(() =>
      writePrelabel(
        { dataset: "src", stem: "missing" },
        resultFor("images/src/missing.jpg"),
      ),
    ).toThrow(/No image/);
    expect(() =>
      writePrelabel(
        { dataset: "src", stem: "a" },
        resultFor("images/src/other.jpg"),
      ),
    ).toThrow(/does not match/);
  });

  test("rejects a version owned by another logical model", async () => {
    await addImages("ownership", [new File(["a"], "a.jpg")]);
    registerModel({
      schemaVersion: 1,
      id: "other-detector",
      name: "Other detector",
      task: "object_detection",
      classes: ["seed"],
    });
    registerModelVersion("other-detector", {
      ...nextPrelabeler,
      version_id: "other-model-v1",
    });

    expect(() => selectModelVersion("ownership", "other-model-v1")).toThrow(
      /belongs to other-detector/,
    );
  });

  test("freezes the prelabel once a label exists", async () => {
    ensureDefaultModel();
    registerModelVersion(DEFAULT_MODEL.id, prelabeler);
    registerModelVersion(DEFAULT_MODEL.id, nextPrelabeler);
    await addImages("frozen", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "frozen", stem: "a" };
    const original = writePrelabel(ref, resultFor("images/frozen/a.jpg"));
    if ("error" in original) throw new Error("unexpected failure document");
    createLabel(ref, documentFromPrelabel(original));

    selectModelVersion("frozen", nextPrelabeler.version_id);
    const replacement = {
      ...resultFor("images/frozen/a.jpg"),
      producer: nextPrelabeler,
    };
    expect(() => writePrelabel(ref, replacement)).toThrow(/frozen/);
    expect(() => discardPrelabel(ref)).toThrow(/frozen/);
    expect(readPrelabel(ref)).toEqual(original);
    expect(
      pendingImages(nextPrelabeler).map((i) => i.dataset),
    ).not.toContain("frozen");
    expect(summarizeImage(ref).state).toBe("in_progress");
  });
});

describe("removal", () => {
  test("deletes the image with its prelabel and label", async () => {
    ensureDefaultModel();
    registerModelVersion(DEFAULT_MODEL.id, prelabeler);
    await addImages("rm", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "rm", stem: "a" };
    const prelabel = writePrelabel(ref, resultFor("images/rm/a.jpg"));
    if ("error" in prelabel) throw new Error("unexpected failure document");
    createLabel(ref, documentFromPrelabel(prelabel));

    removeImage(ref);
    expect(findImage(ref)).toBeNull();
    expect(readPrelabel(ref)).toBeNull();
    expect(fs.existsSync(path.join(DATA_ROOT, "labels", "rm", "a.json"))).toBe(
      false,
    );
    expect(() => removeImage(ref)).toThrow(/No image/);
  });
});
