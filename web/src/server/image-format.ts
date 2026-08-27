import type { ImageExtension } from "../datasets/schema";

/** The leading bytes each accepted format declares itself with. */
export const IMAGE_SIGNATURES: Record<ImageExtension, readonly Uint8Array[]> = {
  ".jpg": [Uint8Array.of(0xff, 0xd8, 0xff)],
  ".png": [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  ".tif": [
    Uint8Array.of(0x49, 0x49, 0x2a, 0x00),
    Uint8Array.of(0x4d, 0x4d, 0x00, 0x2a),
  ],
};

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

/** The format the bytes declare, or null when they are not a photograph we serve. */
export function imageFormat(bytes: Uint8Array): ImageExtension | null {
  for (const [extension, signatures] of Object.entries(IMAGE_SIGNATURES)) {
    if (signatures.some((signature) => startsWith(bytes, signature))) {
      return extension as ImageExtension;
    }
  }
  return null;
}
