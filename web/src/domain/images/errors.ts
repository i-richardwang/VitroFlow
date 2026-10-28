import { NotFoundError } from "../errors";

/** No image with the digest is stored. */
export class ImageNotFoundError extends NotFoundError {
  readonly code = "image_not_found";
}
