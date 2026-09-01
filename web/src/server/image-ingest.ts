import sharp from "sharp";

import {
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_FORMATS,
} from "../images/canonical";
import { contentDigest } from "./blobs";

/**
 * Images enter the system here, once. An uploaded file is a source, not
 * an image: it is decoded, re-encoded into the one form the system stores, and
 * only then does it have an identity. The digest, the blob, the pixel
 * coordinates annotations are drawn in, and the pixels every model trains and
 * predicts on all describe these bytes.
 *
 * Orientation and colour are baked into the pixels because the decoders
 * downstream read neither: an image whose rotation lived in its metadata
 * would be served upright and trained on sideways, and one carrying an ICC
 * profile would be shown in one set of colours and learned in another.
 *
 * The encoding is a property of the system rather than a setting. It decides
 * both the identity of every image and the compression artefacts a model
 * learns as part of its subject, so changing it means re-ingesting every image
 * under new digests and retraining every model. At this quality a 26 MP dish
 * image distorts less than two grey levels of invisible noise while
 * storing in a quarter of the space, and encoder effort beyond zero spends
 * seconds per image to shave a tenth off that without touching fidelity.
 */
const QUALITY = 90;
const EFFORT = 0;

const SOURCE_FORMAT_SET = new Set<string>(SOURCE_IMAGE_FORMATS);

/** A source that cannot enter the canonical image boundary. */
export class ImageSourceError extends Error {}

/** Encoder threads used while processing one image at a time. */
sharp.concurrency(2);

let canonicalizationTail = Promise.resolve();

/**
 * Decoding a maximum-size source dominates workbench memory. HTTP requests may
 * arrive concurrently, but one process materializes only one image at a
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

/** An image as the system stores it. */
export interface CanonicalImage {
  digest: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * The canonical image a source encodes. Sources that do not decode, or
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
  const unsupported = () =>
    new ImageSourceError("The file must contain a JPEG, PNG, or TIFF image");
  const metadata = await image.metadata().catch(() => {
    throw unsupported();
  });
  const { format, width, height } = metadata;
  if (!format || !SOURCE_FORMAT_SET.has(format)) throw unsupported();
  if ((metadata.pages ?? 1) !== 1) {
    throw new ImageSourceError("The file must contain exactly one image");
  }
  if (!width || !height) {
    throw new ImageSourceError("The file does not decode as an image");
  }
  if (width > MAX_EDGE_PIXELS || height > MAX_EDGE_PIXELS) {
    throw new ImageSourceError(
      `Edges longer than ${MAX_EDGE_PIXELS} pixels cannot be stored: ${width}x${height}`,
    );
  }
  const { data, info } = await image
    .rotate()
    .toColourspace("srgb")
    .flatten({ background: "#fff" })
    .avif({ quality: QUALITY, effort: EFFORT })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw new ImageSourceError(
        "The file cannot be converted into a supported image",
      );
    });
  const bytes = new Uint8Array(data);
  return {
    digest: contentDigest(bytes),
    bytes,
    width: info.width,
    height: info.height,
  };
}
