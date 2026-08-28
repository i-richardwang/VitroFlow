import { Button, Modal } from "@heroui/react";

import { UploadCard } from "../UploadCard";

/** Adds photographs to an existing dataset without taking over the page. */
export function UploadDialog({ dataset }: { dataset: string }) {
  return (
    <Modal>
      <Button variant="primary">Add images</Button>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>Add images</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <UploadCard dataset={dataset} onComplete={close} />
                </Modal.Body>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
