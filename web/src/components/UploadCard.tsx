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
            .then(async ({ added, existing }) => {
              setFiles([]);
              toast.success(uploadSummary(target, added, existing));
              await router.invalidate();
            })
            .catch((cause: unknown) => {
              toast.danger("Upload failed", {
                description:
                  cause instanceof Error ? cause.message : String(cause),
              });
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

/** Photographs one request carries; the server re-encodes each one it takes. */
const IMAGES_PER_REQUEST = 4;

/**
 * Adds the photographs a chunk at a time so that no single request waits on
 * the whole batch being re-encoded. Uploads are content addressed and repeat
 * safely, so a batch that stops partway leaves the photographs it did add.
 */
async function uploadImages(
  dataset: string,
  files: File[],
  onProgress: (done: number) => void,
): Promise<{ added: number; existing: number }> {
  let added = 0;
  let existing = 0;
  for (let start = 0; start < files.length; start += IMAGES_PER_REQUEST) {
    const chunk = files.slice(start, start + IMAGES_PER_REQUEST);
    const result = await postImages(dataset, chunk);
    added += result.added;
    existing += result.existing;
    onProgress(start + chunk.length);
  }
  return { added, existing };
}

async function postImages(
  dataset: string,
  files: File[],
): Promise<{ added: number; existing: number }> {
  const data = new FormData();
  for (const file of files) {
    data.append("images", file);
  }
  const response = await fetch(
    `/api/datasets/${encodeURIComponent(dataset)}/images`,
    { method: "POST", body: data },
  );
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    added?: string[];
    existing?: string[];
  } | null;
  if (body?.error != null) {
    throw new Error(body.error);
  }
  if (!response.ok || body?.added == null || body.existing == null) {
    throw new Error(`Upload failed (${response.status})`);
  }
  return { added: body.added.length, existing: body.existing.length };
}
