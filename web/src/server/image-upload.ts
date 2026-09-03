import { MAX_IMAGE_BYTES } from "../images/canonical";
import { imageDigestSchema } from "../images/schema";
import { ImageSourceError } from "./image-ingest";
import { storeCanonicalImage, storeImage } from "./image-store";

function failed(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** The request body, which must be exactly the bytes its length declares. */
async function imageBody(request: Request): Promise<Uint8Array | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    return failed("Image Content-Length is required", 411);
  }
  if (declaredLength > MAX_IMAGE_BYTES) {
    return failed("Image exceeds 64 MiB", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== declaredLength) {
    return failed("Image length differs from Content-Length", 400);
  }
  return bytes;
}

async function storing(
  store: () => Promise<{ digest: string }>,
): Promise<Response> {
  try {
    const stored = await store();
    return Response.json({ digest: stored.digest });
  } catch (error) {
    if (error instanceof ImageSourceError) {
      return failed(error.message, 400);
    }
    console.error(
      `Store image failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return failed("Could not store image", 500);
  }
}

/**
 * Stores one image. The request is its bytes and nothing else: an image is
 * identified by what it contains, and the source name retained with it
 * belongs to the experiment observation that submits it, not to the image.
 */
export async function handleImageUpload(request: Request): Promise<Response> {
  const body = await imageBody(request);
  if (body instanceof Response) return body;
  return storing(() => storeImage(body));
}

/**
 * Stores one canonical image under the digest it is addressed by, as a
 * dataset transfer delivers it. Storing is idempotent: bytes already here
 * are acknowledged the same way.
 */
export async function handleCanonicalImageUpload(
  digest: unknown,
  request: Request,
): Promise<Response> {
  const parsed = imageDigestSchema.safeParse(digest);
  if (!parsed.success) return failed("Not an image digest", 400);
  const body = await imageBody(request);
  if (body instanceof Response) return body;
  return storing(() => storeCanonicalImage(parsed.data, body));
}
