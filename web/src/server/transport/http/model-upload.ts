import { MAX_MODEL_WEIGHTS_BYTES } from "../../../domain/models/transfer";
import { DomainError } from "../../../domain/errors";
import { uploadModelWeights } from "../../models/public";
import { refuseWithoutAgentKey } from "./agent";

export async function serveModelWeightsUpload(
  uploadId: string,
  request: Request,
): Promise<Response> {
  const refusal = await refuseWithoutAgentKey(request);
  if (refusal) return refusal;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0)
    return Response.json(
      { error: "Content-Length is required" },
      { status: 411 },
    );
  if (length > MAX_MODEL_WEIGHTS_BYTES)
    return Response.json({ error: "Weights exceed 512 MiB" }, { status: 413 });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!request.body)
      return Response.json({ error: "Weights are required" }, { status: 400 });
    const reader = request.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > length) {
        await reader.cancel();
        return Response.json(
          { error: "Body exceeds Content-Length" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    if (size !== length)
      return Response.json(
        { error: "Body differs from Content-Length" },
        { status: 400 },
      );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await uploadModelWeights(uploadId, bytes);
    return Response.json({ uploadId });
  } catch (error) {
    if (error instanceof DomainError)
      return Response.json(
        { error: error.message },
        { status: error.category === "not_found" ? 404 : 400 },
      );
    console.error("Model upload failed", error);
    return Response.json(
      { error: "Could not upload weights" },
      { status: 500 },
    );
  }
}
