import { useRouter } from "@tanstack/react-router";
import { FileArchive, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { importDatasetArchive, type ImportProgress } from "./import-archive";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { DropZone } from "../../ui/kit/DropZone";
import { Icon } from "../../ui/kit/Icon";
import { Progress } from "../../ui/kit/Progress";
import { m } from "../../paraglide/messages";

export function ImportDatasetDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.dataset_import_heading()}
      busy={action.busy}
    >
      <ImportArchiveForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

/**
 * Starts the import as soon as an archive is dropped or chosen; its progress
 * stays on screen until the dialog has closed on the imported dataset.
 */
function ImportArchiveForm({
  action: { run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const importArchive = (file: File) =>
    void run(
      () => importDatasetArchive(file, setProgress),
      m.dataset_import_failed(),
    ).then(async (result) => {
      if (!result.ok) {
        setProgress(null);
        return;
      }
      onDone();
      await router.navigate({
        to: "/datasets/$dataset",
        params: { dataset: result.value.id },
      });
    });

  return progress ? (
    <ImportProgressPanel progress={progress} />
  ) : (
    <DropZone
      accept=".zip,application/zip"
      multiple={false}
      icon={FileArchive}
      title={m.dataset_import_drop_label()}
      description={m.dataset_import_drop_description()}
      selectText={m.dataset_import_select()}
      onFiles={([file]) => {
        if (file) importArchive(file);
      }}
    />
  );
}

/** Occupies the drop zone's place while the archive is read and its images stored. */
function ImportProgressPanel({ progress }: { progress: ImportProgress }) {
  const total =
    progress.phase === "reading" ? 0 : progress.manifest.images.length;
  return (
    <div
      aria-live="polite"
      className="flex min-h-40 flex-col justify-center gap-3"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            icon={LoaderCircle}
            size={14}
            spin
            className="text-fg-tertiary"
          />
          {progress.phase === "reading" ? (
            m.dataset_import_reading()
          ) : (
            <span className="truncate">
              {m.dataset_import_storing({
                dataset: progress.manifest.dataset,
              })}
            </span>
          )}
        </span>
        {progress.phase === "reading" ? null : (
          <span className="shrink-0 tabular-nums text-fg-secondary">
            {m.dataset_import_storing_count({ stored: progress.stored, total })}
          </span>
        )}
      </div>
      <Progress
        aria-label={m.dataset_import_progress()}
        value={progress.phase === "reading" ? 0 : progress.stored}
        max={Math.max(total, 1)}
      />
    </div>
  );
}
