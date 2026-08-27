import { imageRefSchema } from "../datasets/schema";
import { readBlob } from "./blobs";
import { findImage } from "./datasets";

export const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** Serves a photograph by reference; unknown references and images are 404. */
export async function imageResponse(
  params: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const ref = imageRefSchema.safeParse(params);
  const image = ref.success ? await findImage(ref.data) : null;
  const contentType = image ? CONTENT_TYPES[image.extension] : undefined;
  if (!image || !contentType) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(readBlob(image.blobKey), {
    headers: { "Content-Type": contentType, ...headers },
  });
}
