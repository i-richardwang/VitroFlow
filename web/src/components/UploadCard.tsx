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
import { useState } from "react";

import { DATASET_NAME_PATTERN } from "../datasets/schema";
import { ImageDropZone, type ListedImage } from "./ImageDropZone";

/**
 * Adds images to a dataset. With a fixed dataset the form only asks for
 * files; otherwise the dataset name is typed and created on first upload.
 */
export function UploadCard({
  dataset,
  onComplete,
}: {
  dataset?: string;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<ListedImage[]>([]);
  const [busy, setBusy] = useState(false);

  const form = (
    <Form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        const target =
          dataset ??
          String(new FormData(event.currentTarget).get("dataset") ?? "");
        setBusy(true);
        void uploadImages(
          target,
          files.map((item) => item.file),
          (index, update) => {
            setFiles((current) =>
              current.map((item, currentIndex) =>
                currentIndex === index ? { ...item, ...update } : item,
              ),
            );
          },
        )
          .then(async ({ added, existing, failed }) => {
            setFiles(failed.map((failure) => ({ file: failure.file })));
            if (added + existing > 0) {
              toast.success(uploadSummary(target, added, existing));
            }
            for (const { file, reason } of failed) {
              toast.danger(file.name, { description: reason });
            }
            await router.invalidate();
            if (failed.length === 0) {
              onComplete?.();
            }
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {dataset ? (
        <div className="flex flex-col gap-3">
          <ImageDropZone
            files={files}
            onChange={(next) => setFiles(next.map((file) => ({ file })))}
            busy={busy}
          />
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || files.length === 0}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
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
          <ImageDropZone
            files={files}
            onChange={(next) => setFiles(next.map((file) => ({ file })))}
            busy={busy}
          />
          <Fieldset.Actions>
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy || files.length === 0}
            >
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </Fieldset.Actions>
        </Fieldset>
      )}
    </Form>
  );

  return form;
}

function uploadSummary(target: string, added: number, existing: number) {
  const count = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;
  if (added === 0) return `${count(existing)} already in ${target}`;
  if (existing === 0) return `${count(added)} added to ${target}`;
  return `${count(added)} added to ${target}, ${existing} already there`;
}

/**
 * Requests kept in flight while the server serializes canonicalization. One
 * photograph can travel while the preceding one encodes.
 */
const UPLOAD_LANES = 2;

interface UploadFailure {
  file: File;
  reason: string;
}

interface UploadOutcome {
  added: number;
  existing: number;
  failed: UploadFailure[];
}

/**
 * Adds the photographs one request each. Every photograph stands alone, so one
 * that will not decode is reported against its own name and left in the picker
 * while the rest go through.
 */
async function uploadImages(
  dataset: string,
  files: File[],
  onFile: (
    index: number,
    update: ListedImage,
  ) => void,
): Promise<UploadOutcome> {
  const failures = new Array<UploadFailure | null>(files.length).fill(null);
  let added = 0;
  let existing = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_LANES, files.length) }, async () => {
      for (let index = next++; index < files.length; index = next++) {
        const file = files[index]!;
        onFile(index, { file, status: "uploading", progress: 0 });
        try {
          const addedThis = await postImage(dataset, file, (progress) => {
            onFile(index, { file, status: "uploading", progress });
          });
          if (addedThis) {
            added += 1;
          } else {
            existing += 1;
          }
          onFile(index, { file, status: "complete", progress: 100 });
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          failures[index] = { file, reason };
          onFile(index, { file, status: "failed", progress: 0 });
        }
      }
    }),
  );
  return {
    added,
    existing,
    failed: failures.filter(
      (failure): failure is UploadFailure => failure !== null,
    ),
  };
}

/** Whether the photograph joined the dataset, rather than already being in it. */
function postImage(
  dataset: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `/api/datasets/${encodeURIComponent(dataset)}/images?filename=${encodeURIComponent(file.name)}`,
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      const body = parseBody(request.responseText);
      if (body?.error != null) {
        reject(new Error(body.error));
        return;
      }
      if (request.status >= 200 && request.status < 300 && body?.added != null) {
        resolve(body.added);
        return;
      }
      reject(new Error(`Upload failed (${request.status})`));
    };
    request.onerror = () => {
      reject(new Error("Upload failed"));
    };
    request.send(file);
  });
}

function parseBody(text: string): { error?: string; added?: boolean } | null {
  try {
    return JSON.parse(text) as { error?: string; added?: boolean };
  } catch {
    return null;
  }
}
