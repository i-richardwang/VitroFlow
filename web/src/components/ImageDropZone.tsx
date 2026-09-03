import { DropZone } from "@heroui-pro/react/drop-zone";
import { toast } from "@heroui/react";
import { useCallback, type ReactNode } from "react";

import {
  MAX_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_EXTENSIONS,
  sourceImageFileError,
} from "../images/canonical";

export interface ListedImage {
  id: number;
  file: File;
  state:
    | { status: "storing"; progress: number }
    | { status: "stored"; digest: string }
    | { status: "failed"; reason: string };
}

const ITEM_STATUS = {
  storing: "uploading",
  stored: "complete",
  failed: "failed",
} as const;

export function ImageDropZone({
  images,
  onAdd,
  onRemove,
  busy,
  annotate,
}: {
  images: ListedImage[];
  onAdd: (files: File[]) => void;
  onRemove: (id: number) => void;
  busy: boolean;
  annotate?: (image: ListedImage) => ReactNode;
}) {
  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted = incoming.filter((file) => {
        const error = sourceImageFileError(file);
        if (error) toast.danger(file.name, { description: error });
        return error === null;
      });
      if (accepted.length > 0) onAdd(accepted);
    },
    [onAdd],
  );

  return (
    <DropZone className="w-full">
      <DropZone.Area
        isDisabled={busy}
        onDrop={async (event) => {
          const dropped: File[] = [];
          for (const item of event.items) {
            if (item.kind === "file") {
              dropped.push(await item.getFile());
            }
          }
          addFiles(dropped);
        }}
      >
        <DropZone.Icon />
        <DropZone.Label>Drop images here or browse</DropZone.Label>
        <DropZone.Description>
          JPEG, PNG, or TIFF · {MAX_IMAGE_BYTES / (1024 * 1024)} MiB ·{" "}
          {MAX_SOURCE_IMAGE_PIXELS / 1_000_000} MP
        </DropZone.Description>
        <DropZone.Trigger isDisabled={busy}>Select images</DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        aria-label="Select images"
        accept={SOURCE_IMAGE_EXTENSIONS.join(",")}
        disabled={busy}
        multiple
        onSelect={(list) => addFiles(Array.from(list))}
      />
      {images.length > 0 && (
        <DropZone.FileList>
          {images.map(({ id, file, state }) => {
            const ext = extension(file.name);
            return (
              <DropZone.FileItem key={id} status={ITEM_STATUS[state.status]}>
                <DropZone.FileFormatIcon
                  color={ext === "tif" || ext === "tiff" ? "purple" : "green"}
                  format={ext.toUpperCase()}
                />
                <DropZone.FileInfo>
                  <DropZone.FileName>{file.name}</DropZone.FileName>
                  <DropZone.FileMeta>
                    {formatSize(file.size)}
                    {state.status === "storing" && ` | ${state.progress}%`}
                    {state.status === "stored" && (
                      <span className="text-success"> | ready</span>
                    )}
                    {state.status === "failed" && (
                      <span className="text-danger"> | {state.reason}</span>
                    )}
                  </DropZone.FileMeta>
                  {state.status === "storing" && (
                    <DropZone.FileProgress
                      aria-label={`Upload progress for ${file.name}`}
                      value={state.progress}
                    >
                      <DropZone.FileProgressTrack>
                        <DropZone.FileProgressFill />
                      </DropZone.FileProgressTrack>
                    </DropZone.FileProgress>
                  )}
                </DropZone.FileInfo>
                <div className="flex shrink-0 items-center gap-2 self-center">
                  {annotate?.({ id, file, state })}
                  {busy ? null : (
                    <DropZone.FileRemoveTrigger
                      aria-label={`Remove ${file.name}`}
                      onPress={() => onRemove(id)}
                    />
                  )}
                </div>
              </DropZone.FileItem>
            );
          })}
        </DropZone.FileList>
      )}
    </DropZone>
  );
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
