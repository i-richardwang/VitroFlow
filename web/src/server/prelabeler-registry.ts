import * as fs from "node:fs";

import {
  registeredPrelabelerSchema,
  samePrelabelerDescriptor,
  type PrelabelerDescriptor,
} from "../prelabelers/schema";
import { createAtomically } from "./files";
import { PRELABELERS_DIR, resolveWithin } from "./paths";

function versionPath(versionId: string): string {
  return resolveWithin(PRELABELERS_DIR, `${versionId}.json`);
}

export function readPrelabeler(
  versionId: string,
): PrelabelerDescriptor | null {
  const filePath = versionPath(versionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return registeredPrelabelerSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf-8")),
  ).descriptor;
}

/** Registers an immutable executable version, rejecting reused identities. */
export function registerPrelabeler(
  descriptor: PrelabelerDescriptor,
): PrelabelerDescriptor {
  const created = createAtomically(
    versionPath(descriptor.version_id),
    `${JSON.stringify({ schemaVersion: 1, descriptor }, null, 2)}\n`,
  );
  if (created) {
    return descriptor;
  }
  const existing = readPrelabeler(descriptor.version_id);
  if (!existing || !samePrelabelerDescriptor(existing, descriptor)) {
    throw new Error(
      `Prelabeler version ${descriptor.version_id} is already registered with different contents`,
    );
  }
  return existing;
}
