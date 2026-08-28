import { DropZone } from "@heroui-pro/react/drop-zone";
import { toast } from "@heroui/react";
import { useCallback } from "react";

import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_EXTENSIONS,
  sourceImageFileError,
} from "../images/canonical";

export function ImageDropZone({
  files,
  onChange,
  progress,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  progress: { done: number; total: number } | null;
}) {
  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted = incoming.filter((file) => {
        const error = sourceImageFileError(file);
        if (error) toast.danger(file.name, { description: error });
        return error === null;
      });
      if (accepted.length === 0) {
        return;
      }
      onChange([...files, ...accepted]);
    },
    [files, onChange],
  );

  return (
    <DropZone className="w-full">
      <DropZone.Area
        isDisabled={progress != null}
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
          JPEG, PNG, or TIFF, up to {MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)} MiB
          and {MAX_SOURCE_IMAGE_PIXELS / 1_000_000} MP each. Every photograph is
          re-encoded on arrival into the one format the workbench stores.
        </DropZone.Description>
        <DropZone.Trigger isDisabled={progress != null}>
          Select images
        </DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        accept={SOURCE_IMAGE_EXTENSIONS.join(",")}
        disabled={progress != null}
        multiple
        onSelect={(list) => addFiles(Array.from(list))}
      />
      {files.length > 0 && (
        <DropZone.FileList>
          {files.map((file, index) => {
            const ext = extension(file.name);
            return (
              <DropZone.FileItem
                key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                status={progress != null ? "uploading" : undefined}
              >
                <DropZone.FileFormatIcon
                  color={ext === "tif" || ext === "tiff" ? "purple" : "green"}
                  format={ext.toUpperCase()}
                />
                <DropZone.FileInfo>
                  <DropZone.FileName>{file.name}</DropZone.FileName>
                  <DropZone.FileMeta>{formatSize(file.size)}</DropZone.FileMeta>
                </DropZone.FileInfo>
                {progress == null && (
                  <DropZone.FileRemoveTrigger
                    aria-label={`Remove ${file.name}`}
                    onPress={() =>
                      onChange(files.filter((item) => item !== file))
                    }
                  />
                )}
              </DropZone.FileItem>
            );
          })}
        </DropZone.FileList>
      )}
      {progress && (
        <DropZone.FileProgress
          className="gap-1"
          maxValue={progress.total}
          minValue={0}
          value={progress.done}
        >
          <DropZone.FileProgressTrack>
            <DropZone.FileProgressFill />
          </DropZone.FileProgressTrack>
          <span className="text-xs tabular-nums text-muted">
            {progress.done} / {progress.total} images
          </span>
        </DropZone.FileProgress>
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
