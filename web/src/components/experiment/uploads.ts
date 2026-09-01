import { useCallback, useEffect, useRef, useState } from "react";

import { parseHttpJson } from "../../http/json";
import { storedImageResponseSchema } from "../../images/schema";
import type { ListedImage } from "../ImageDropZone";

/**
 * Images travelling at once. A second request keeps the server encoding
 * while the next image is still on the wire; more than that would queue
 * behind the same processor.
 */
const UPLOAD_LANES = 2;

export interface Uploads {
  images: ListedImage[];
  add: (files: File[]) => void;
  remove: (id: number) => void;
  clearStored: () => void;
  storing: boolean;
  failed: boolean;
}

/**
 * Images stored ahead of the record that will refer to them. Bytes go up
 * as soon as they are dropped, so assigning them afterwards is a decision rather
 * than a wait.
 */
export function useUploads(): Uploads {
  const [images, setImages] = useState<ListedImage[]>([]);
  const nextId = useRef(0);
  const queue = useRef<ListedImage[]>([]);
  const lanes = useRef(0);
  const abort = useRef<AbortController | null>(null);

  /**
   * Leaving the form cancels what is still on the wire. The controller is
   * dropped with it, because an aborted one refuses every later upload and a
   * remounted form is a form that uploads again.
   */
  useEffect(
    () => () => {
      queue.current = [];
      abort.current?.abort();
      abort.current = null;
    },
    [],
  );

  const update = useCallback((id: number, state: ListedImage["state"]) => {
    setImages((current) =>
      current.map((image) => (image.id === id ? { ...image, state } : image)),
    );
  }, []);

  const add = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({
        id: (nextId.current += 1),
        file,
        state: { status: "storing", progress: 0 } as const,
      }));
      setImages((current) => [...current, ...added]);
      queue.current.push(...added);
      const { signal } = (abort.current ??= new AbortController());
      while (lanes.current < UPLOAD_LANES && queue.current.length > 0) {
        lanes.current += 1;
        void (async () => {
          for (let next = queue.current.shift(); next;) {
            if (signal.aborted) break;
            const { id, file } = next;
            try {
              const { digest } = await storeImage(
                file,
                (progress) => update(id, { status: "storing", progress }),
                signal,
              );
              if (signal.aborted) break;
              update(id, { status: "stored", digest });
            } catch (cause) {
              if (!signal.aborted) {
                update(id, { status: "failed", reason: message(cause) });
              }
            }
            next = queue.current.shift();
          }
          lanes.current -= 1;
        })();
      }
    },
    [update],
  );

  const remove = useCallback((id: number) => {
    queue.current = queue.current.filter((image) => image.id !== id);
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const clearStored = useCallback(() => {
    setImages((current) =>
      current.filter((image) => image.state.status !== "stored"),
    );
  }, []);

  return {
    images,
    add,
    remove,
    clearStored,
    storing: images.some((image) => image.state.status === "storing"),
    failed: images.some((image) => image.state.status === "failed"),
  };
}

export function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function storeImage(
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
