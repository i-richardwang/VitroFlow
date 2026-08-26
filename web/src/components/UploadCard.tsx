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
    loaded: number;
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
          setProgress({
            loaded: 0,
            total: files.reduce((sum, file) => sum + file.size, 0),
          });
          void uploadImages(target, files, (loaded, total) => {
            setProgress({ loaded, total });
          })
            .then(async (added) => {
              setFiles([]);
              toast.success(
                `${added} ${added === 1 ? "image" : "images"} added to ${target}`,
              );
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

function uploadImages(
  dataset: string,
  files: File[],
  onProgress: (loaded: number, total: number) => void,
): Promise<number> {
  const data = new FormData();
  for (const file of files) {
    data.append("images", file);
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/datasets/${encodeURIComponent(dataset)}/images`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };
    request.onload = () => {
      let body: { error?: string; added?: string[] } | null;
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        body = null;
      }
      if (body?.error != null) {
        reject(new Error(body.error));
      } else if (request.status >= 400 || body?.added == null) {
        reject(new Error(`Upload failed (${request.status})`));
      } else {
        resolve(body.added.length);
      }
    };
    request.onerror = () => {
      reject(new Error("Upload failed"));
    };
    request.send(data);
  });
}
