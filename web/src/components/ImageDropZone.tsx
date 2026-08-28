import { DropZone } from "@heroui-pro/react/drop-zone";
import { toast } from "@heroui/react";
import { useCallback } from "react";

import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_EXTENSIONS,
  sourceImageFileError,
} from "../images/canonical";

export type ListedImage = {
  file: File;
  status?: "uploading" | "complete" | "failed";
  progress?: number;
};

export function ImageDropZone({
  files,
  onChange,
  busy,
}: {
  files: ListedImage[];
  onChange: (files: File[]) => void;
  busy: boolean;
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
      onChange([...files.map((item) => item.file), ...accepted]);
    },
    [files, onChange],
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
          JPEG, PNG, or TIFF · {MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)} MiB ·{" "}
          {MAX_SOURCE_IMAGE_PIXELS / 1_000_000} MP
        </DropZone.Description>
        <DropZone.Trigger isDisabled={busy}>Select images</DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        accept={SOURCE_IMAGE_EXTENSIONS.join(",")}
        disabled={busy}
        multiple
        onSelect={(list) => addFiles(Array.from(list))}
      />
      {files.length > 0 && (
        <DropZone.FileList>
          {files.map((item, index) => {
            const ext = extension(item.file.name);
            return (
              <DropZone.FileItem
                key={`${item.file.name}:${item.file.size}:${item.file.lastModified}:${index}`}
                status={item.status}
              >
                <DropZone.FileFormatIcon
                  color={ext === "tif" || ext === "tiff" ? "purple" : "green"}
                  format={ext.toUpperCase()}
                />
                <DropZone.FileInfo>
                  <DropZone.FileName>{item.file.name}</DropZone.FileName>
                  <DropZone.FileMeta>
                    {formatSize(item.file.size)}
                    {item.status === "uploading" &&
                      item.progress != null &&
                      ` | ${item.progress}%`}
                    {item.status === "complete" && (
                      <span className="text-success"> | 100%</span>
                    )}
                  </DropZone.FileMeta>
                  {item.status === "uploading" && (
                    <DropZone.FileProgress
                      aria-label={`Upload progress for ${item.file.name}`}
                      value={item.progress ?? 0}
                    >
                      <DropZone.FileProgressTrack>
                        <DropZone.FileProgressFill />
                      </DropZone.FileProgressTrack>
                    </DropZone.FileProgress>
                  )}
                </DropZone.FileInfo>
                {!busy && (
                  <DropZone.FileRemoveTrigger
                    aria-label={`Remove ${item.file.name}`}
                    onPress={() =>
                      onChange(
                        files
                          .filter((_, current) => current !== index)
                          .map((listed) => listed.file),
                      )
                    }
                  />
                )}
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
