import { z } from "zod";

import { readStoredZip } from "../archive/zip";
import { parseHttpJson } from "../http/json";
import { MAX_IMAGE_BYTES } from "../images/canonical";
import { imageDigestSchema } from "../images/schema";
import { m } from "../paraglide/messages";
import {
  encodeDatasetManifest,
  datasetManifestSchema,
  MAX_DATASET_IMAGES,
  MAX_DATASET_MANIFEST_BYTES,
  type DatasetManifest,
} from "./manifest";
import { datasetSchema, type Dataset } from "./schema";

/**
 * A dataset archive is a data root for one dataset, zipped: the manifest
 * under `datasets/` and every image it names under `blobs/`, so what a
 * browser downloads is what the CLI pulls, and either can be pushed back.
 * The manifest comes first so a reader knows what to expect of the rest.
 */

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

function entryKind(name: string): EntryKind | null {
  const manifest = MANIFEST_ENTRY.exec(name);
  if (manifest) return { kind: "manifest", dataset: manifest[1]! };
  const blob = BLOB_ENTRY.exec(name);
  if (blob) return { kind: "blob", digest: blob[2]! };
  return null;
}

/** Why an archive cannot be imported as it stands. */
export class DatasetArchiveError extends Error {}

export type ImportProgress =
  | { phase: "reading" }
  | {
      phase: "storing";
      manifest: DatasetManifest;
      /** Images the workbench has acknowledged so far. */
      stored: number;
    };

export const DATASET_ARCHIVE_LIMITS = {
  maxEntries: MAX_DATASET_IMAGES + 1,
  maxEntryBytes: MAX_IMAGE_BYTES,
};

const storedImageSchema = z.strictObject({ digest: imageDigestSchema });
const importedDatasetSchema = z.strictObject({ dataset: datasetSchema });
const errorResponseSchema = z.strictObject({ error: z.string().min(1) });

async function refusal(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

async function responseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return parseHttpJson(await response.text(), response.status, schema);
  } catch (error) {
    throw new DatasetArchiveError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Imports the archive into the workbench serving the page: every image it
 * carries goes up first, one request each, and the manifest last, which the
 * workbench applies as a whole. Nothing is sent when the dataset already
 * exists, and an archive the workbench refuses never creates the dataset.
 */
export async function importDatasetArchive(
  archive: Blob,
  onProgress: (progress: ImportProgress) => void,
): Promise<Dataset> {
  onProgress({ phase: "reading" });
  let manifest: DatasetManifest | null = null;
  const expected = new Map<string, number>();
  const stored = new Set<string>();
  for await (const entry of readStoredZip(
    archive.stream(),
    DATASET_ARCHIVE_LIMITS,
  )) {
    const kind = entryKind(entry.name);
    if (!kind) {
      throw new DatasetArchiveError(
        m.dataset_archive_unexpected_entry({ entry: entry.name }),
      );
    }
    if (kind.kind === "manifest") {
      if (manifest) {
        throw new DatasetArchiveError(m.dataset_archive_multiple_datasets());
      }
      if (entry.bytes.byteLength > MAX_DATASET_MANIFEST_BYTES) {
        throw new DatasetArchiveError(m.dataset_archive_manifest_too_large());
      }
      let document: unknown;
      try {
        document = JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown;
      } catch {
        throw new DatasetArchiveError(m.dataset_archive_manifest_not_json());
      }
      const parsed = datasetManifestSchema.safeParse(document);
      if (!parsed.success || parsed.data.dataset !== kind.dataset) {
        throw new DatasetArchiveError(m.dataset_archive_manifest_invalid());
      }
      manifest = parsed.data;
      for (const image of manifest.images) {
        expected.set(image.digest, image.bytes);
      }
      const existing = await fetch(
        `/api/transfer/datasets/${encodeURIComponent(manifest.dataset)}`,
        { redirect: "error" },
      );
      if (existing.status === 200) {
        throw new DatasetArchiveError(
          m.dataset_archive_exists({ dataset: manifest.dataset }),
        );
      }
      if (existing.status !== 404) {
        throw new DatasetArchiveError(
          await refusal(existing, m.dataset_archive_destination_unchecked()),
        );
      }
      onProgress({ phase: "storing", manifest, stored: 0 });
      continue;
    }
    if (!manifest) {
      throw new DatasetArchiveError(m.dataset_archive_manifest_first());
    }
    const expectedBytes = expected.get(kind.digest);
    if (expectedBytes === undefined) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_unnamed({ digest: kind.digest }),
      );
    }
    if (stored.has(kind.digest)) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_duplicate({ digest: kind.digest }),
      );
    }
    if (entry.bytes.byteLength !== expectedBytes) {
      throw new DatasetArchiveError(
        m.dataset_archive_image_size({ digest: kind.digest }),
      );
    }
    const response = await fetch(`/api/transfer/images/${kind.digest}`, {
      method: "PUT",
      headers: { "content-type": "image/avif" },
      body: entry.bytes,
      redirect: "error",
    });
    const accepted = await responseJson(response, storedImageSchema);
    if (accepted.digest !== kind.digest) {
      throw new DatasetArchiveError(m.dataset_archive_image_mismatch());
    }
    stored.add(kind.digest);
    onProgress({ phase: "storing", manifest, stored: stored.size });
  }
  if (!manifest) throw new DatasetArchiveError(m.dataset_archive_no_dataset());
  const missing = [...expected.keys()].filter((digest) => !stored.has(digest));
  if (missing.length > 0) {
    throw new DatasetArchiveError(
      m.dataset_archive_images_missing({ count: missing.length }),
    );
  }
  const response = await fetch(
    `/api/transfer/datasets/${encodeURIComponent(manifest.dataset)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: encodeDatasetManifest(manifest),
      redirect: "error",
    },
  );
  return (await responseJson(response, importedDatasetSchema)).dataset;
}
