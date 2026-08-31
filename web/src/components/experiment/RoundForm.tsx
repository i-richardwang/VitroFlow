import { Button, Fieldset, Form, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { parseHttpJson } from "../../http/json";
import { storedImageResponseSchema } from "../../images/schema";
import { ImageDropZone, type ListedImage } from "../ImageDropZone";

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

export function RoundForm({
  fields,
  submitLabel,
  busyLabel,
  onCancel,
  onSubmit,
  onComplete,
}: {
  fields?: (busy: boolean) => ReactNode;
  submitLabel: string;
  busyLabel: string;
  onCancel?: () => void;
  onSubmit: (photos: StoredPhoto[], form: FormData) => Promise<string>;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [images, setImages] = useState<ListedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const queue = useRef<ListedImage[]>([]);
  const lanes = useRef(0);
  const uploadAbort = useRef(new AbortController());

  useEffect(
    () => () => {
      queue.current = [];
      uploadAbort.current.abort();
    },
    [],
  );

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
            if (uploadAbort.current.signal.aborted) break;
            const { id, file } = next;
            try {
              const { digest } = await storeImage(
                file,
                (progress) => update(id, { status: "storing", progress }),
                uploadAbort.current.signal,
              );
              if (uploadAbort.current.signal.aborted) break;
              update(id, { status: "stored", digest });
            } catch (cause) {
              if (!uploadAbort.current.signal.aborted) {
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
          .then((summary) => {
            setImages((current) =>
              current.filter((image) => image.state.status !== "stored"),
            );
            toast.success(summary);
            if (!hasFailures) onComplete?.();
            void router.invalidate();
          })
          .catch((cause: unknown) => {
            toast.danger("Nothing was added", { description: message(cause) });
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Fieldset className="w-full">
        {fields?.(busy)}
        <ImageDropZone
          images={images}
          onAdd={onAdd}
          onRemove={onRemove}
          busy={busy}
        />
        <Fieldset.Actions>
          {onCancel ? (
            <Button variant="tertiary" onPress={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || storing || ready.length === 0}
          >
            {busy ? busyLabel : storing ? "Preparing…" : submitLabel}
          </Button>
        </Fieldset.Actions>
      </Fieldset>
    </Form>
  );
}

function message(cause: unknown): string {
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
