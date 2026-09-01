import {
  Button,
  Dropdown,
  Fieldset,
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
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";

type Action = "reassign" | "unassign";

export function ObservationImageMenu({
  image,
  navigation,
  observations,
}: {
  image: ExperimentObservationImage;
  navigation: ObservationUnitNavigationEntry[];
  observations: ExperimentObservation[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly aria-label="Image actions">
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Image actions"
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="reassign" textValue="Reassign image">
              <Label>Reassign…</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="unassign"
              textValue="Unassign image"
              variant="danger"
            >
              <Label>Unassign image…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "reassign" ? (
        <ReassignModal
          image={image}
          navigation={navigation}
          observations={observations}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "unassign"}
        onOpenChange={(next) => setOpen(next ? "unassign" : null)}
        title={`Unassign the image of ${image.observationUnit.code}?`}
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
        The cell empties. The image stays stored, with its detection and review,
        and can be assigned again.
      </DeleteDialog>
    </>
  );
}

function ReassignModal({
  image,
  navigation,
  observations,
  onClose,
}: {
  image: ExperimentObservationImage;
  navigation: ObservationUnitNavigationEntry[];
  observations: ExperimentObservation[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observationUnit, setObservationUnit] = useState(
    image.observationUnit.id,
  );
  const [observation, setObservation] = useState(image.observation.id);

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Reassign {image.filename}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
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
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <Select
                      variant="secondary"
                      fullWidth
                      isDisabled={busy}
                      selectedKey={observationUnit}
                      onSelectionChange={(key) =>
                        setObservationUnit(String(key))
                      }
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
                              <Label>{item.code}</Label>
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
                              <Label>{observationLabel(item)}</Label>
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </Fieldset.Group>
                  <Fieldset.Actions>
                    <Button variant="tertiary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Reassigning…" : "Reassign"}
                    </Button>
                  </Fieldset.Actions>
                </Fieldset>
              </Form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
