import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Binary content the database only references, addressed by a relative key:
 *
 *   images/<xx>/<sha256>                   photographs, by content digest
 *   training-staging/<run>/                uploaded but unpublished artifacts
 *   model-artifacts/<version>/weights/     published executable weights
 *
 * Photographs are content addressed, so identical uploads share one blob and
 * snapshots reference images without copying them.
 */
export const DATA_ROOT =
  process.env.VITROFLOW_DATA_ROOT ?? path.resolve(process.cwd(), "..", "data");

/** The SHA-256 digest that identifies content, as lower-case hex. */
export function contentDigest(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function imageBlobKey(digest: string): string {
  return `images/${digest.slice(0, 2)}/${digest}`;
}

function blobPath(key: string): string {
  const resolved = path.resolve(DATA_ROOT, key);
  if (resolved !== DATA_ROOT && !resolved.startsWith(DATA_ROOT + path.sep)) {
    throw new Error(`Blob key escapes the data root: ${key}`);
  }
  return resolved;
}

export function blobExists(key: string): boolean {
  return fs.existsSync(blobPath(key));
}

export function readBlob(key: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(fs.readFileSync(blobPath(key)));
}

/** Readers never observe a partially written blob. */
export function writeBlob(key: string, contents: Uint8Array | string): void {
  const filePath = blobPath(key);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

/** Keys of the blobs under a directory, walked in full. */
export function listBlobs(directory: string): string[] {
  const root = blobPath(directory);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(DATA_ROOT, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

export function removeBlob(key: string): void {
  fs.rmSync(blobPath(key), { force: true });
}

/** Moves a directory of blobs; a no-op once the destination exists. */
export function moveBlobDirectory(from: string, to: string): void {
  const destination = blobPath(to);
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(blobPath(from), destination);
}
