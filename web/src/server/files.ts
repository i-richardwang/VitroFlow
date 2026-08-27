import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export function writeAtomically(
  filePath: string,
  contents: Uint8Array | string,
): void {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

/** Publishes complete contents only when the destination does not exist. */
export function createAtomically(
  filePath: string,
  contents: Uint8Array | string,
): boolean {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, contents);
    try {
      fs.linkSync(tempPath, filePath);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        return false;
      }
      throw error;
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

/** Publishes a populated directory with one atomic rename. */
export function createDirectoryAtomically(
  directory: string,
  populate: (temporary: string) => void,
): boolean {
  const parent = path.dirname(directory);
  const temporary = path.join(
    parent,
    `.${path.basename(directory)}.${process.pid}.${randomUUID()}.tmp`,
  );
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(temporary);
  try {
    populate(temporary);
    try {
      fs.renameSync(temporary, directory);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EEXIST", "ENOTEMPTY"].includes(String(error.code))
      ) {
        return false;
      }
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
