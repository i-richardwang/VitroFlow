import { Button, Modal } from "@heroui/react";

import type { DatasetOverview } from "../../server/overview";
import { VersionsTable } from "./VersionsTable";

/** Switches which version prelabels this dataset. */
export function VersionsDialog({ overview }: { overview: DatasetOverview }) {
  if (overview.versions.length === 0) {
    return null;
  }

  return (
    <Modal>
      <Button variant="ghost">Versions</Button>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Versions</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <VersionsTable
                dataset={overview.dataset.id}
                versions={overview.versions}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
