import { DropZone } from "@heroui-pro/react/drop-zone";
import { Button, Label, Modal, ProgressBar, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  importDatasetArchive,
  type ImportProgress,
} from "../../datasets/archive";
import { errorMessage } from "../../hooks/useAsyncAction";

export function ImportDatasetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        Import
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
      toast.success(`Imported ${dataset.id}`);
      onClose();
      await router.navigate({
        to: "/datasets/$dataset",
        params: { dataset: dataset.id },
      });
    } catch (error) {
      toast.danger("Import failed", { description: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && !busy && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Import dataset</Modal.Heading>
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
                Cancel
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
        <DropZone.Label>Drop a dataset archive here or browse</DropZone.Label>
        <DropZone.Description>
          A ZIP downloaded from a workbench dataset
        </DropZone.Description>
        <DropZone.Trigger>Select archive</DropZone.Trigger>
      </DropZone.Area>
      <DropZone.Input
        aria-label="Select archive"
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
        aria-label="Import progress"
        isIndeterminate
        className="w-full"
      >
        <Label>Reading archive</Label>
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
    );
  }
  const total = progress.manifest.images.length;
  return (
    <ProgressBar
      aria-label="Import progress"
      value={total === 0 ? 100 : (progress.stored / total) * 100}
      className="w-full"
    >
      <Label>
        {`Storing ${progress.manifest.dataset}: ${progress.stored} of ${total} images`}
      </Label>
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
