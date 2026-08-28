import type { DatasetImage } from "./datasets";

type DocumentImage =
  | { digest: string }
  | { digest: string; width: number; height: number };

/** A persisted document must describe the canonical photograph it belongs to. */
export function assertDocumentImage(
  subject: string,
  document: DocumentImage,
  image: Pick<DatasetImage, "digest" | "width" | "height">,
): void {
  if (document.digest !== image.digest) {
    throw new Error(
      `${subject} describes ${document.digest}, not ${image.digest}`,
    );
  }
  if (
    "width" in document &&
    (document.width !== image.width || document.height !== image.height)
  ) {
    throw new Error(
      `${subject} describes ${document.width}x${document.height}, ` +
        `not ${image.width}x${image.height}`,
    );
  }
}
