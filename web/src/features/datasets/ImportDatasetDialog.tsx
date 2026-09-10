import { DropZone } from "@heroui-pro/react/drop-zone";
import { Button, Label, Modal, ProgressBar, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { importDatasetArchive, type ImportProgress } from "./import-archive";
import { errorMessage } from "../../ui/errors";
import { m } from "../../paraglide/messages";

export function ImportDatasetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        {m.dataset_import()}
      </Button>
      <ImportDatasetDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ImportDatasetDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const busy = progress !== null;

  const importArchive = async (file: File) => {
    try {
      const dataset = await importDatasetArchive(file, setProgress);
      toast.success(m.dataset_import_done({ dataset: dataset.id }));
      onClose();
      await router.navigate({
        to: "/datasets/$dataset",
        params: { dataset: dataset.id },
      });
    } catch (error) {
      toast.danger(m.dataset_import_failed(), {
        description: errorMessage(error),
      });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && !busy && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.dataset_import_heading()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {progress ? (
                <ImportProgressBar progress={progress} />
              ) : (
                <ArchiveDropZone onSelect={importArchive} />
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose} isDisabled={busy}>
                {m.cancel()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ArchiveDropZone({ onSelect }: { onSelect: (file: File) => void }) {
  return (
    <DropZone className="w-full">
      <DropZone.Area
        onDrop={async (event) => {
          for (const item of event.items) {
            if (item.kind === "file") {
              onSelect(await item.getFile());
              return;
            }
          }
        }}
      >
        <DropZone.Icon />
        <DropZone.Label>{m.dataset_import_drop_label()}</DropZone.Label>
        <DropZone.Description>
          {m.dataset_import_drop_description()}
        </DropZone.Description>
        <DropZone.Trigger>{m.dataset_import_select()}</DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        aria-label={m.dataset_import_select()}
        accept=".zip,application/zip"
        onSelect={(list) => {
          const file = list?.[0];
          if (file) onSelect(file);
        }}
      />
    </DropZone>
  );
}

function ImportProgressBar({ progress }: { progress: ImportProgress }) {
  if (progress.phase === "reading") {
    return (
      <ProgressBar
        aria-label={m.dataset_import_progress()}
        isIndeterminate
        className="w-full"
      >
        <Label>{m.dataset_import_reading()}</Label>
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
    );
  }
  const total = progress.manifest.images.length;
  return (
    <ProgressBar
      aria-label={m.dataset_import_progress()}
      value={total === 0 ? 100 : (progress.stored / total) * 100}
      className="w-full"
    >
      <Label>
        {m.dataset_import_storing({
          dataset: progress.manifest.dataset,
          stored: progress.stored,
          total,
        })}
      </Label>
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
