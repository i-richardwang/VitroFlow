import sharp from "sharp";

import {
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_FORMATS,
} from "../images/canonical";
import { contentDigest } from "./blobs";

/**
 * Photographs enter the system here, once. An uploaded file is a source, not
 * an image: it is decoded, re-encoded into the one form the system stores, and
 * only then does it have an identity. The digest, the blob, the pixel
 * coordinates annotations are drawn in, and the pixels every model trains and
 * predicts on all describe these bytes.
 *
 * Orientation and colour are baked into the pixels because the decoders
 * downstream read neither: a photograph whose rotation lived in its metadata
 * would be served upright and trained on sideways, and one carrying an ICC
 * profile would be shown in one set of colours and learned in another.
 *
 * The encoding is a property of the system rather than a setting. It decides
 * both the identity of every photograph and the compression artefacts a model
 * learns as part of its subject, so changing it means re-ingesting every image
 * under new digests and retraining every model. At this quality a 26 MP dish
 * photograph distorts less than two grey levels of invisible noise while
 * storing in a quarter of the space, and encoder effort beyond zero spends
 * seconds per image to shave a tenth off that without touching fidelity.
 */
const QUALITY = 90;
const EFFORT = 0;

const SOURCE_FORMAT_SET = new Set<string>(SOURCE_IMAGE_FORMATS);

/** Encoder threads used by the one photograph processed at a time. */
sharp.concurrency(2);

let canonicalizationTail = Promise.resolve();

/**
 * Decoding a maximum-size source dominates workbench memory. HTTP requests may
 * arrive concurrently, but one process materializes only one photograph at a
 * time; the next request can finish travelling while the current image encodes.
 */
async function inCanonicalizationSlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = canonicalizationTail;
  let release!: () => void;
  canonicalizationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

/** The longest edge AVIF can represent. */
const MAX_EDGE_PIXELS = 16384;

/** A photograph as the system stores it. */
export interface CanonicalImage {
  digest: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * The canonical photograph a source encodes. Sources that do not decode, or
 * whose pixels no encoding can hold, are refused rather than approximated.
 */
export async function canonicalize(
  source: Uint8Array,
): Promise<CanonicalImage> {
  return inCanonicalizationSlot(() => canonicalizeSource(source));
}

async function canonicalizeSource(source: Uint8Array): Promise<CanonicalImage> {
  const image = sharp(source, {
    failOn: "error",
    limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
  });
  const metadata = await image.metadata();
  const { format, width, height } = metadata;
  if (!format || !SOURCE_FORMAT_SET.has(format)) {
    throw new Error("The file must contain a JPEG, PNG, or TIFF photograph");
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error("The file must contain exactly one photograph");
  }
  if (!width || !height) {
    throw new Error("The file does not decode as a photograph");
  }
  if (width > MAX_EDGE_PIXELS || height > MAX_EDGE_PIXELS) {
    throw new Error(
      `Edges longer than ${MAX_EDGE_PIXELS} pixels cannot be stored: ${width}x${height}`,
    );
  }
  const { data, info } = await image
    .rotate()
    .toColourspace("srgb")
    .flatten({ background: "#fff" })
    .avif({ quality: QUALITY, effort: EFFORT })
    .toBuffer({ resolveWithObject: true });
  const bytes = new Uint8Array(data);
  return {
    digest: contentDigest(bytes),
    bytes,
    width: info.width,
    height: info.height,
  };
}
