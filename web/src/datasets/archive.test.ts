import { expect, spyOn, test } from "bun:test";

import { storedZip, type ArchiveEntry } from "../archive/zip";
import {
  blobEntryName,
  DatasetArchiveError,
  importDatasetArchive,
  manifestEntryName,
} from "./archive";
import type { DatasetManifest } from "./manifest";

const DIGEST = "a".repeat(64);

function manifest(images: DatasetManifest["images"]): DatasetManifest {
  return {
    schemaVersion: 1,
    dataset: "archive-test",
    model: { id: "seed-detector", classes: ["seed"] },
    images,
  };
}

function manifestEntry(document: DatasetManifest): ArchiveEntry {
  return {
    name: manifestEntryName(document.dataset),
    bytes: new TextEncoder().encode(JSON.stringify(document)),
  };
}

async function archive(entries: ArchiveEntry[]): Promise<Blob> {
  return new Response(storedZip(entries)).blob();
}

test("an archive contains only protocol entries", async () => {
  await expect(
    importDatasetArchive(
      await archive([{ name: "notes.txt", bytes: new Uint8Array([1]) }]),
      () => {},
    ),
  ).rejects.toThrow("Unexpected archive entry: notes.txt");
});

test("an archive cannot carry an image absent from its manifest", async () => {
  const request = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 404 }),
  );
  try {
    await expect(
      importDatasetArchive(
        await archive([
          manifestEntry(manifest([])),
          { name: blobEntryName(DIGEST), bytes: new Uint8Array([1]) },
        ]),
        () => {},
      ),
    ).rejects.toThrow(`The manifest does not name image ${DIGEST}`);
  } finally {
    request.mockRestore();
  }
});

test("an archive contains each declared image exactly once", async () => {
  const request = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ digest: DIGEST }));
  const image = {
    digest: DIGEST,
    width: 1,
    height: 1,
    filename: "seed.avif",
    bytes: 1,
    split: null,
    detection: null,
    annotation: null,
  };
  try {
    await expect(
      importDatasetArchive(
        await archive([
          manifestEntry(manifest([image])),
          { name: blobEntryName(DIGEST), bytes: new Uint8Array([1]) },
          { name: blobEntryName(DIGEST), bytes: new Uint8Array([1]) },
        ]),
        () => {},
      ),
    ).rejects.toThrow(`The archive contains image ${DIGEST} more than once`);
  } finally {
    request.mockRestore();
  }
});

test("archive import reports reading before storage", async () => {
  const request = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 404 }),
  );
  const phases: string[] = [];
  try {
    await expect(
      importDatasetArchive(
        await archive([manifestEntry(manifest([]))]),
        (progress) => phases.push(progress.phase),
      ),
    ).rejects.toBeInstanceOf(DatasetArchiveError);
  } finally {
    request.mockRestore();
  }
  expect(phases).toEqual(["reading", "storing"]);
});
