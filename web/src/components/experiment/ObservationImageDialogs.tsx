import {
  Button,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type {
  ExperimentObservationImage,
  ObservationUnitNavigationEntry,
} from "../../experiments/contracts";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import {
  reassignObservationImage,
  unassignObservationImage,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DestructiveActionDialog } from "../DestructiveActionDialog";

export function ReassignObservationImageModal({
  image,
  navigation,
  observations,
  isOpen,
  onClose,
}: {
  image: ExperimentObservationImage;
  navigation: ObservationUnitNavigationEntry[];
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observationUnit, setObservationUnit] = useState(
    image.observationUnit.id,
  );
  const [observation, setObservation] = useState(image.observation.id);

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Reassign {image.filename}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="reassign-image"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      reassignObservationImage({
                        data: { ...image.ref, observationUnit, observation },
                      }),
                    "Image not reassigned",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.navigate({
                      to: "/experiments/$experiment/$observationUnit",
                      params: {
                        experiment: image.ref.experiment,
                        observationUnit,
                      },
                      search: { observation },
                    });
                  });
                }}
              >
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={observationUnit}
                  onSelectionChange={(key) => setObservationUnit(String(key))}
                >
                  <Label>Observation unit</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {navigation.map((item) => (
                        <ListBox.Item
                          key={item.id}
                          id={item.id}
                          textValue={item.code}
                        >
                          {item.code}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={observation}
                  onSelectionChange={(key) => setObservation(String(key))}
                >
                  <Label>Observation</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {observations.map((item) => (
                        <ListBox.Item
                          key={item.id}
                          id={item.id}
                          textValue={observationLabel(item)}
                        >
                          {observationLabel(item)}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="reassign-image"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Reassigning…" : "Reassign"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function UnassignObservationImageDialog({
  image,
  isOpen,
  onOpenChange,
}: {
  image: ExperimentObservationImage;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  return (
    <DestructiveActionDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Unassign image?"
      confirmLabel="Unassign image"
      onConfirm={async () => {
        await unassignObservationImage({ data: image.ref });
        toast.success("Image unassigned");
        await router.navigate({
          to: "/experiments/$experiment",
          params: { experiment: image.ref.experiment },
        });
      }}
    >
      The image stays stored.
    </DestructiveActionDialog>
  );
}
