import { FieldError, Input, Label, TextField } from "@heroui/react";

import { DATASET_NAME_PATTERN } from "../datasets/schema";
import { ImageBatchForm, postJson, type StoredPhoto } from "./ImageBatchForm";

/** Adds photographs to a dataset, naming a new one when none is given. */
export function UploadCard({
  dataset,
  onComplete,
}: {
  dataset?: string;
  onComplete?: () => void;
}) {
  return (
    <ImageBatchForm
      fields={
        dataset
          ? undefined
          : (busy) => (
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
            )
      }
      submitLabel="Upload"
      busyLabel="Adding…"
      onSubmit={async (photos, form) => {
        const target = dataset ?? String(form.get("dataset") ?? "");
        const { added, existing } = await claimImages(target, photos);
        return uploadSummary(target, added, existing);
      }}
      onComplete={onComplete}
    />
  );
}

function uploadSummary(target: string, added: number, existing: number) {
  const count = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;
  if (added === 0) return `${count(existing)} already in ${target}`;
  if (existing === 0) return `${count(added)} added to ${target}`;
  return `${count(added)} added to ${target}, ${existing} already there`;
}

/** Claims the stored photographs for the dataset under the names they came as. */
function claimImages(dataset: string, images: StoredPhoto[]) {
  return postJson<{ added: number; existing: number }>(
    `/api/datasets/${encodeURIComponent(dataset)}/images`,
    { images },
  );
}
