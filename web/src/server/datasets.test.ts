import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { documentFromPrelabel } from "../annotation/prelabel";
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

const prelabeler = {
  version_id: "traditional-test",
  fingerprint: "b".repeat(64),
};

function resultFor(source: string) {
  return { ...makeResult([{ id: 0, x: 10, y: 10 }]), source };
}

function pending() {
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
  test("reads legacy center detections through the canonical box contract", async () => {
    await addImages("legacy", [new File(["a"], "a.jpg")]);
    const directory = path.join(DATA_ROOT, "prelabels", "legacy");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "a.json"),
      JSON.stringify({
        source: "images/legacy/a.jpg",
        image: { width: 100, height: 80 },
        count: 1,
        quality: {
          status: "ok",
          warnings: [],
          clipped_fraction: 0.01,
          focus_score: 20,
        },
        dish: { center_x: 50, center_y: 40, radius: 200 },
        pipeline: { name: "legacy", fingerprint: "a".repeat(64) },
        model: { name: "legacy model", fingerprint: "b".repeat(64) },
        config: { decision: { confidence_threshold: 0.5 } },
        detections: [{ id: 7, x: 10, y: 12, scale: 4, score: 0.9 }],
      }),
    );

    const prelabel = readPrelabel({ dataset: "legacy", stem: "a" });
    if (!prelabel || "error" in prelabel) {
      throw new Error("legacy result did not migrate");
    }
    expect(prelabel.schema_version).toBe(1);
    expect(prelabel.producer.kind).toBe("traditional");
    expect(prelabel.instances).toEqual([
      {
        id: "7",
        class: "seed",
        bbox: { x: 7.5, y: 9.5, width: 5, height: 5 },
        score: 0.9,
      },
    ]);
  });

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
      pendingImages({
        version_id: "traditional-next",
        fingerprint: "c".repeat(64),
      }).map((i) => i.stem),
    ).toContain("a");

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
    createLabel(ref, documentFromPrelabel(original));

    const replacement = {
      ...resultFor("images/frozen/a.jpg"),
      producer: {
        version_id: "traditional-next",
        name: "next",
        kind: "traditional",
        fingerprint: "c".repeat(64),
      },
    };
    expect(() => writePrelabel(ref, replacement)).toThrow(/frozen/);
    expect(() => discardPrelabel(ref)).toThrow(/frozen/);
    expect(readPrelabel(ref)).toEqual(original);
    expect(
      pendingImages({
        version_id: "traditional-next",
        fingerprint: "c".repeat(64),
      }).map((i) => i.dataset),
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
