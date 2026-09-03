import { expect, test } from "bun:test";

import { readStoredZip } from "../archive/zip";
import { DATASET_ARCHIVE_LIMITS } from "../datasets/archive";
import { datasetManifestSchema } from "../datasets/manifest";
import { imageBlobKey, requireBlob } from "./blobs";
import { datasetArchive } from "./dataset-archive";
import { reviewedDataset } from "./testing";

test("an archive holds the manifest first and then every image by digest", async () => {
  const seeded = await reviewedDataset("archive-set", ["ar-a", "ar-b"]);
  const stream = await datasetArchive("archive-set");
  if (!stream) throw new Error("no archive");
  const entries = [];
  for await (const entry of readStoredZip(stream, DATASET_ARCHIVE_LIMITS)) {
    entries.push(entry);
  }

  expect(entries[0]?.name).toBe("datasets/archive-set.json");
  const manifest = datasetManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(entries[0]!.bytes)),
  );
  expect(manifest.images.map((image) => image.digest)).toEqual(seeded.digests);
  expect(entries.slice(1).map((entry) => entry.name)).toEqual(
    seeded.digests.map((digest) => `blobs/${digest.slice(0, 2)}/${digest}`),
  );
  for (const [index, digest] of seeded.digests.entries()) {
    expect(entries[index + 1]!.bytes).toEqual(
      new Uint8Array(await requireBlob(imageBlobKey(digest))),
    );
  }
  expect(await datasetArchive("archive-nowhere")).toBeNull();
});
