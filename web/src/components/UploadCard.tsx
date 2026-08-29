import {
  Button,
  FieldError,
  Fieldset,
  Form,
  Input,
  Label,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { DATASET_NAME_PATTERN } from "../datasets/schema";
import { ImageDropZone, type ListedImage } from "./ImageDropZone";

/**
 * Adds photographs to a dataset. Storing a photograph and claiming it are
 * separate acts, and the form follows them: bytes go up as soon as they are
 * chosen, so the seconds spent naming the dataset and reviewing the list are
 * the seconds they travel and encode in. Submitting only claims what is
 * already stored, which is one small request.
 */
export function UploadCard({
  dataset,
  onComplete,
}: {
  dataset?: string;
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

  /** The photographs a submission would claim, as the dataset will name them. */
  const ready = images.flatMap(({ file, state }) =>
    state.status === "stored"
      ? [{ digest: state.digest, filename: file.name }]
      : [],
  );
  const storing = images.some((image) => image.state.status === "storing");
  const hasFailures = images.some((image) => image.state.status === "failed");

  const picker = (
    <ImageDropZone
      images={images}
      onAdd={onAdd}
      onRemove={onRemove}
      busy={busy}
    />
  );
  const submit = (
    <Button
      type="submit"
      variant="primary"
      isDisabled={busy || storing || ready.length === 0}
    >
      {busy ? "Adding…" : storing ? "Preparing…" : "Upload"}
    </Button>
  );

  return (
    <Form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        const target =
          dataset ??
          String(new FormData(event.currentTarget).get("dataset") ?? "");
        setBusy(true);
        void claimImages(target, ready)
          .then(async ({ added, existing }) => {
            setImages((current) =>
              current.filter((image) => image.state.status !== "stored"),
            );
            toast.success(uploadSummary(target, added, existing));
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
      {dataset ? (
        <div className="flex flex-col gap-3">
          {picker}
          {submit}
        </div>
      ) : (
        <Fieldset>
          <Fieldset.Group>
            <TextField
              fullWidth
              isRequired
              isDisabled={busy}
              name="dataset"
              pattern={DATASET_NAME_PATTERN}
            >
              <Label>Dataset</Label>
              <Input className="font-mono" placeholder="seed-2026-08" />
              <FieldError />
            </TextField>
          </Fieldset.Group>
          {picker}
          <Fieldset.Actions>{submit}</Fieldset.Actions>
        </Fieldset>
      )}
    </Form>
  );
}

function uploadSummary(target: string, added: number, existing: number) {
  const count = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;
  if (added === 0) return `${count(existing)} already in ${target}`;
  if (existing === 0) return `${count(added)} added to ${target}`;
  return `${count(added)} added to ${target}, ${existing} already there`;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Photographs travelling at once. A second request keeps the server encoding
 * while the next photograph is still on the wire; more than that would queue
 * behind the same processor.
 */
const UPLOAD_LANES = 2;

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
      const body = parse<{ error?: string; digest?: string }>(
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

/** Claims the stored photographs for the dataset under the names they came as. */
async function claimImages(
  dataset: string,
  images: { digest: string; filename: string }[],
): Promise<{ added: number; existing: number }> {
  const response = await fetch(
    `/api/datasets/${encodeURIComponent(dataset)}/images`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images }),
    },
  );
  const body = parse<{ error?: string; added?: number; existing?: number }>(
    await response.text(),
  );
  if (body?.error != null) throw new Error(body.error);
  if (!response.ok || body?.added == null || body.existing == null) {
    throw new Error(`Upload failed (${response.status})`);
  }
  return { added: body.added, existing: body.existing };
}

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
