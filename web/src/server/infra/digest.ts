import { createHash } from "node:crypto";

/** The SHA-256 digest that identifies content, as lower-case hex. */
export function contentDigest(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}
