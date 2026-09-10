import { parseHttpJson } from "../../lib/http/json";
import { storedImageResponseSchema } from "../../domain/images/schema";

export function storeImage(
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<{ digest: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.open("POST", "/api/images");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      try {
        resolve(
          parseHttpJson(
            request.responseText,
            request.status,
            storedImageResponseSchema,
          ),
        );
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Upload failed"));
    };
    request.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Upload cancelled"));
    };
    request.send(file);
  });
}
