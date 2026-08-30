import { Button, Form, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { ImageDropZone, type ListedImage } from "./ImageDropZone";

/** A stored photograph as the submission will hand it over. */
export interface StoredPhoto {
  digest: string;
  filename: string;
}

/**
 * Photographs travelling at once. A second request keeps the server encoding
 * while the next photograph is still on the wire; more than that would queue
 * behind the same processor.
 */
const UPLOAD_LANES = 2;

/**
 * Collects photographs for one submission. Storing a photograph and using it
 * are separate acts, and the form follows them: bytes go up as soon as they
 * are chosen, so the seconds spent filling in the rest of the form are the
 * seconds they travel and encode in. Submitting hands over only what is
 * already stored, which is one small request the caller makes.
 */
export function ImageBatchForm({
  fields,
  submitLabel,
  busyLabel,
  onSubmit,
  onComplete,
}: {
  /** Inputs shown above the picker; their values arrive with the submission. */
  fields?: (busy: boolean) => ReactNode;
  submitLabel: string;
  busyLabel: string;
  /** Hands the stored photographs over; resolves to the message to show. */
  onSubmit: (photos: StoredPhoto[], form: FormData) => Promise<string>;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [images, setImages] = useState<ListedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const queue = useRef<ListedImage[]>([]);
  const lanes = useRef(0);

  const update = useCallback((id: number, state: ListedImage["state"]) => {
    setImages((current) =>
      current.map((image) => (image.id === id ? { ...image, state } : image)),
    );
  }, []);

  const onAdd = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({
        id: (nextId.current += 1),
        file,
        state: { status: "storing", progress: 0 } as const,
      }));
      setImages((current) => [...current, ...added]);
      queue.current.push(...added);
      while (lanes.current < UPLOAD_LANES && queue.current.length > 0) {
        lanes.current += 1;
        void (async () => {
          for (let next = queue.current.shift(); next;) {
            const { id, file } = next;
            try {
              const { digest } = await storeImage(file, (progress) =>
                update(id, { status: "storing", progress }),
              );
              update(id, { status: "stored", digest });
            } catch (cause) {
              update(id, { status: "failed", reason: message(cause) });
            }
            next = queue.current.shift();
          }
          lanes.current -= 1;
        })();
      }
    },
    [update],
  );

  const onRemove = useCallback((id: number) => {
    queue.current = queue.current.filter((image) => image.id !== id);
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const ready: StoredPhoto[] = images.flatMap(({ file, state }) =>
    state.status === "stored"
      ? [{ digest: state.digest, filename: file.name }]
      : [],
  );
  const storing = images.some((image) => image.state.status === "storing");
  const hasFailures = images.some((image) => image.state.status === "failed");

  return (
    <Form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        void onSubmit(ready, form)
          .then(async (summary) => {
            setImages((current) =>
              current.filter((image) => image.state.status !== "stored"),
            );
            toast.success(summary);
            await router.invalidate();
            if (!hasFailures) onComplete?.();
          })
          .catch((cause: unknown) => {
            toast.danger("Nothing was added", { description: message(cause) });
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <div className="flex w-full flex-col gap-3">
        {fields?.(busy)}
        <ImageDropZone
          images={images}
          onAdd={onAdd}
          onRemove={onRemove}
          busy={busy}
        />
        <Button
          type="submit"
          variant="primary"
          isDisabled={busy || storing || ready.length === 0}
        >
          {busy ? busyLabel : storing ? "Preparing…" : submitLabel}
        </Button>
      </div>
    </Form>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Stores one photograph's bytes, reporting how much of them has gone. */
function storeImage(
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ digest: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/images");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      const body = parseJson<{ error?: string; digest?: string }>(
        request.responseText,
      );
      if (body?.error != null) return reject(new Error(body.error));
      if (request.status === 200 && body?.digest) {
        return resolve({ digest: body.digest });
      }
      reject(new Error(`Upload failed (${request.status})`));
    };
    request.onerror = () => reject(new Error("Upload failed"));
    request.send(file);
  });
}

/** Posts JSON and returns the body, surfacing the server's error message. */
export async function postJson<T extends object>(
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = parseJson<T & { error?: string }>(await response.text());
  if (parsed?.error != null) throw new Error(parsed.error);
  if (!response.ok || parsed == null) {
    throw new Error(`Request failed (${response.status})`);
  }
  return parsed;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
