import {
  Button,
  Card,
  Description,
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
import { ImageDropZone } from "./ImageDropZone";

/**
 * Adds images to a dataset. With a fixed dataset the card only asks for
 * files; otherwise the dataset name is typed and created on first upload.
 */
export function UploadCard({ dataset }: { dataset?: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  return (
    <Card className="p-6">
      <Form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          const target =
            dataset ??
            String(new FormData(event.currentTarget).get("dataset") ?? "");
          setProgress({ done: 0, total: files.length });
          void uploadImages(target, files, (done) => {
            setProgress({ done, total: files.length });
          })
            .then(async ({ added, existing, failed }) => {
              setFiles(failed.map((failure) => failure.file));
              if (added + existing > 0) {
                toast.success(uploadSummary(target, added, existing));
              }
              for (const { file, reason } of failed) {
                toast.danger(file.name, { description: reason });
              }
              await router.invalidate();
            })
            .finally(() => {
              setProgress(null);
            });
        }}
      >
        <Fieldset>
          <Fieldset.Legend>
            {dataset ? "Add images" : "Upload images"}
          </Fieldset.Legend>
          <Description>
            {dataset
              ? "A connected worker detects seeds in new images as soon as they arrive."
              : "Name a new or existing dataset. Names use letters, numbers, dots, dashes, and underscores."}
          </Description>
          {!dataset && (
            <Fieldset.Group>
              <TextField
                fullWidth
                isRequired
                isDisabled={progress != null}
                name="dataset"
                pattern={DATASET_NAME_PATTERN}
              >
                <Label>Dataset</Label>
                <Input className="font-mono" placeholder="seed-2026-08" />
                <FieldError />
              </TextField>
            </Fieldset.Group>
          )}
          <div className="flex w-full flex-col gap-1">
            <Label isRequired>Images</Label>
            <ImageDropZone
              files={files}
              onChange={setFiles}
              progress={progress}
            />
          </div>
          <Fieldset.Actions>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isDisabled={progress != null || files.length === 0}
            >
              {progress == null ? "Upload" : "Uploading…"}
            </Button>
          </Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>
  );
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
  onProgress: (done: number) => void,
): Promise<UploadOutcome> {
  const failures = new Array<UploadFailure | null>(files.length).fill(null);
  let added = 0;
  let existing = 0;
  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_LANES, files.length) }, async () => {
      for (let index = next++; index < files.length; index = next++) {
        const file = files[index]!;
        try {
          if (await postImage(dataset, file)) {
            added += 1;
          } else {
            existing += 1;
          }
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          failures[index] = { file, reason };
        }
        onProgress((done += 1));
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
async function postImage(dataset: string, file: File): Promise<boolean> {
  const response = await fetch(
    `/api/datasets/${encodeURIComponent(dataset)}/images?filename=${encodeURIComponent(file.name)}`,
    { method: "POST", body: file },
  );
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    added?: boolean;
  } | null;
  if (body?.error != null) {
    throw new Error(body.error);
  }
  if (!response.ok || body?.added == null) {
    throw new Error(`Upload failed (${response.status})`);
  }
  return body.added;
}
