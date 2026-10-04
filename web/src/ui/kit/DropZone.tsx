import { FileUp, X } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { ActionIcon } from "./ActionIcon";
import { Button } from "./Button";
import { cn } from "./cn";
import { Icon, type IconProps } from "./Icon";
import { Progress } from "./Progress";

/*
 * A drop area with a button that opens the file chooser, and the list of
 * files taken so far. The caller validates and keeps the files: `onFiles`
 * receives what was dropped or chosen, and each `DropZoneFile` shows one
 * entry with its status.
 *
 * The area marks itself `data-dragging` while files are held over it; the
 * enter/leave pairs of nested children are counted so it does not flicker.
 */

export interface DropZoneProps {
  /** File types the chooser offers, as for `<input accept>`. Drops are not filtered. */
  accept?: string;
  /** The file list, usually a `DropZoneFileList`. */
  children?: ReactNode;
  className?: string;
  /** Limits or hints under the title. */
  description?: ReactNode;
  disabled?: boolean;
  icon?: IconProps["icon"];
  /**
   * Whether the chooser takes several files. A drop always passes every file
   * to `onFiles`, and the caller picks among them.
   */
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** Label of the button that opens the chooser. */
  selectText?: string;
  title?: ReactNode;
}

export function DropZone({
  accept,
  children,
  className,
  description,
  disabled = false,
  icon = FileUp,
  multiple = true,
  onFiles,
  selectText,
  title,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const select = selectText ?? m.ui_drop_zone_select();

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };
  const holdsFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  return (
    <div className={cn("ui-drop-zone", className)}>
      <fieldset
        aria-labelledby={titleId}
        className="ui-drop-zone-area"
        data-disabled={disabled ? "" : undefined}
        data-dragging={dragging ? "" : undefined}
        onDragEnter={(event) => {
          if (disabled || !holdsFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (disabled || !holdsFiles(event)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (disabled || !holdsFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          take(event.dataTransfer.files);
        }}
      >
        <span aria-hidden className="ui-drop-zone-icon">
          <Icon icon={icon} size={{ size: 28, strokeWidth: 1.5 }} />
        </span>
        <div className="ui-drop-zone-text">
          <div className="ui-drop-zone-title" id={titleId}>
            {title ?? m.ui_drop_zone_title()}
          </div>
          {description && (
            <div className="ui-drop-zone-description">{description}</div>
          )}
        </div>
        <Button
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          size="small"
        >
          {select}
        </Button>
        <input
          accept={accept}
          aria-label={select}
          className="ui-drop-zone-input"
          disabled={disabled}
          multiple={multiple}
          onChange={(event) => {
            take(event.currentTarget.files);
            // Choosing the same file again must fire `change` again.
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
      </fieldset>
      {children}
    </div>
  );
}

export function DropZoneFileList({ children }: { children: ReactNode }) {
  return <ul className="ui-drop-zone-file-list">{children}</ul>;
}

export type DropZoneFileStatus = "uploading" | "done" | "error";

export interface DropZoneFileProps {
  /** Extra controls before the remove button. */
  actions?: ReactNode;
  /** Shown in the tile at the start; defaults to the file's extension. */
  icon?: ReactNode;
  name: string;
  onRemove?: () => void;
  /** 0 to 100; the bar shows while the status is `uploading`. */
  progress?: number;
  /** Bytes. */
  size: number;
  status?: DropZoneFileStatus;
  /** Written after the size, colored by the status. */
  statusText?: ReactNode;
}

function formatSize(bytes: number, locale: string) {
  if (bytes < 1024) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "byte",
      unitDisplay: "short",
    }).format(bytes);
  }
  if (bytes < 1024 ** 2) {
    const amount = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(bytes / 1024);
    return `${amount} KiB`;
  }
  const amount = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(bytes / 1024 ** 2);
  return `${amount} MiB`;
}

function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

export function DropZoneFile({
  actions,
  icon,
  name,
  onRemove,
  progress,
  size,
  status,
  statusText,
}: DropZoneFileProps) {
  const locale = getLocale();
  return (
    <li className="ui-drop-zone-file" data-status={status}>
      <span aria-hidden className="ui-drop-zone-file-icon">
        {icon ?? extension(name).slice(0, 4)}
      </span>
      <div className="ui-drop-zone-file-info">
        <div className="ui-drop-zone-file-name" title={name}>
          {name}
        </div>
        <div className="ui-drop-zone-file-meta">
          <span>{formatSize(size, locale)}</span>
          {statusText != null && (
            <span className="ui-drop-zone-file-status">{statusText}</span>
          )}
        </div>
        {status === "uploading" && progress !== undefined && (
          <Progress
            aria-label={m.ui_drop_zone_progress({ file: name })}
            className="ui-drop-zone-file-progress"
            max={100}
            value={progress}
          />
        )}
      </div>
      {(actions || onRemove) && (
        <div className="ui-drop-zone-file-actions">
          {actions}
          {onRemove && (
            <ActionIcon
              aria-label={m.ui_drop_zone_remove({ file: name })}
              icon={X}
              onClick={onRemove}
              size="small"
            />
          )}
        </div>
      )}
    </li>
  );
}
