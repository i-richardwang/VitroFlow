import * as fs from "node:fs";
import * as path from "node:path";

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
