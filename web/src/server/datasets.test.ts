import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { documentFromResult } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import { findImage, listDatasets, listImages, removeImage } from "./datasets";
import { summarizeImage } from "./summaries";
import { createLabel } from "./labels";
import { DATA_ROOT } from "./paths";
import {
  discardPrelabel,
  pendingImages,
  readPrelabel,
  writePrelabel,
} from "./prelabels";
import { addImages } from "./upload";

const execution = { pipeline: "a".repeat(64), model: "b".repeat(64) };

function resultFor(source: string) {
  return { ...makeResult([{ id: 0, x: 10, y: 10 }]), source };
}

function pending() {
  return pendingImages(execution).map(
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
  test("pending covers unprocessed and outdated images until a label exists", async () => {
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

    expect(
      pendingImages({ ...execution, model: "c".repeat(64) }).map((i) => i.stem),
    ).toContain("a");

    const { pipeline, model, config } = resultFor("images/pend/b.jpg");
    writePrelabel(b, {
      source: "images/pend/b.jpg",
      error: "boom",
      pipeline,
      model,
      config,
    });
    expect(summarizeImage(b).state).toBe("failed");
    expect(summarizeImage(b).error).toBe("boom");
    expect(pending()).not.toContain("pend/b");

    discardPrelabel(b);
    expect(pending()).toContain("pend/b");
  });

  test("rejects documents for unknown images or mismatched sources", async () => {
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

  test("freezes the prelabel once a label exists", async () => {
    await addImages("frozen", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "frozen", stem: "a" };
    const original = writePrelabel(ref, resultFor("images/frozen/a.jpg"));
    if ("error" in original) throw new Error("unexpected failure document");
    createLabel(ref, documentFromResult(original));

    const replacement = {
      ...resultFor("images/frozen/a.jpg"),
      model: { name: "next", fingerprint: "c".repeat(64) },
    };
    expect(() => writePrelabel(ref, replacement)).toThrow(/frozen/);
    expect(() => discardPrelabel(ref)).toThrow(/frozen/);
    expect(readPrelabel(ref)).toEqual(original);
    expect(
      pendingImages({ ...execution, model: "c".repeat(64) }).map(
        (i) => i.dataset,
      ),
    ).not.toContain("frozen");
    expect(summarizeImage(ref).state).toBe("in_progress");
  });
});

describe("removal", () => {
  test("deletes the image with its prelabel and label", async () => {
    await addImages("rm", [new File(["a"], "a.jpg")]);
    const ref = { dataset: "rm", stem: "a" };
    const prelabel = writePrelabel(ref, resultFor("images/rm/a.jpg"));
    if ("error" in prelabel) throw new Error("unexpected failure document");
    createLabel(ref, documentFromResult(prelabel));

    removeImage(ref);
    expect(findImage(ref)).toBeNull();
    expect(readPrelabel(ref)).toBeNull();
    expect(fs.existsSync(path.join(DATA_ROOT, "labels", "rm", "a.json"))).toBe(
      false,
    );
    expect(() => removeImage(ref)).toThrow(/No image/);
  });
});
