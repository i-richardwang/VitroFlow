/**
 * A dataset archive is a data root for one dataset, zipped: the manifest
 * under `datasets/` and every image it names under `blobs/`, so what a
 * browser downloads is what the CLI pulls, and either can be pushed back.
 * The manifest comes first so a reader knows what to expect of the rest.
 */

import { MAX_IMAGE_BYTES } from "../images/canonical";
import { MAX_DATASET_IMAGES } from "./manifest";

export function manifestEntryName(dataset: string): string {
  return `datasets/${dataset}.json`;
}

export function blobEntryName(digest: string): string {
  return `blobs/${digest.slice(0, 2)}/${digest}`;
}

export function archiveFilename(dataset: string): string {
  return `${dataset}.zip`;
}

type EntryKind =
  { kind: "manifest"; dataset: string } | { kind: "blob"; digest: string };

const MANIFEST_ENTRY = /^datasets\/([^/]+)\.json$/;

const BLOB_ENTRY = /^blobs\/([0-9a-f]{2})\/(\1[0-9a-f]{62})$/;

export function entryKind(name: string): EntryKind | null {
  const manifest = MANIFEST_ENTRY.exec(name);
  if (manifest) return { kind: "manifest", dataset: manifest[1]! };
  const blob = BLOB_ENTRY.exec(name);
  if (blob) return { kind: "blob", digest: blob[2]! };
  return null;
}

export const DATASET_ARCHIVE_LIMITS = {
  maxEntries: MAX_DATASET_IMAGES + 1,
  maxEntryBytes: MAX_IMAGE_BYTES,
};
