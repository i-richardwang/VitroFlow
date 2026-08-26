import { DropZone } from "@heroui-pro/react/drop-zone";
import { useCallback } from "react";

const ACCEPT = [".jpg", ".jpeg", ".png", ".tif", ".tiff"] as const;
const ACCEPT_SET = new Set<string>(ACCEPT);

export function ImageDropZone({
  files,
  onChange,
  progress,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  progress: { loaded: number; total: number } | null;
}) {
  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted = incoming.filter((file) =>
        ACCEPT_SET.has(`.${extension(file.name)}`),
      );
      if (accepted.length === 0) {
        return;
      }
      onChange(mergeFiles(files, accepted));
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
          JPEG, PNG, or TIFF. Up to 100 files, 64 MiB each and 512 MiB total.
        </DropZone.Description>
        <DropZone.Trigger isDisabled={progress != null}>
          Select images
        </DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        accept={ACCEPT.join(",")}
        disabled={progress != null}
        multiple
        onSelect={(list) => addFiles(Array.from(list))}
      />
      {files.length > 0 && (
        <DropZone.FileList>
          {files.map((file) => {
            const ext = extension(file.name);
            return (
              <DropZone.FileItem
                key={`${file.name}:${file.size}`}
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
          value={progress.loaded}
        >
          <DropZone.FileProgressTrack>
            <DropZone.FileProgressFill />
          </DropZone.FileProgressTrack>
          <span className="text-xs tabular-nums text-muted">
            {formatSize(progress.loaded)} / {formatSize(progress.total)}
          </span>
        </DropZone.FileProgress>
      )}
    </DropZone>
  );
}

function mergeFiles(current: File[], incoming: File[]): File[] {
  const names = new Set(current.map((file) => file.name.toLocaleLowerCase()));
  const next = [...current];
  for (const file of incoming) {
    const key = file.name.toLocaleLowerCase();
    if (names.has(key)) {
      continue;
    }
    names.add(key);
    next.push(file);
  }
  return next;
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
