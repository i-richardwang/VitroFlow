/** Source files accepted at the photograph boundary. */
export const SOURCE_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
] as const;

/** Decoder format names corresponding to the accepted source extensions. */
export const SOURCE_IMAGE_FORMATS = ["jpeg", "png", "tiff"] as const;

/** Bounds the decoded memory of one source while covering 26 MP photographs. */
export const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;

/** Bounds the encoded request memory of one source. */
export const MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024;

/** Every stored photograph is an opaque, oriented sRGB AVIF. */
export const CANONICAL_IMAGE_MEDIA_TYPE = "image/avif";

/** Why a browser file cannot enter the photograph boundary. */
export function sourceImageFileError(file: {
  name: string;
  size: number;
}): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!SOURCE_IMAGE_EXTENSIONS.some((accepted) => accepted === extension)) {
    return "Choose a JPEG, PNG, or TIFF photograph";
  }
  if (file.size === 0) return "The file is empty";
  if (file.size > MAX_SOURCE_IMAGE_BYTES) return "The file exceeds 64 MiB";
  return null;
}
