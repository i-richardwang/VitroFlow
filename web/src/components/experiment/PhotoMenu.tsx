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

import type { DishStep, ExperimentPhoto } from "../../experiments/contracts";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import {
  refilePhotograph,
  removePhotograph,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";

type Action = "refile" | "remove";

export function PhotoMenu({
  photo,
  roster,
  observations,
}: {
  photo: ExperimentPhoto;
  roster: DishStep[];
  observations: ExperimentObservation[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly aria-label="Photograph actions">
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Photograph actions"
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="refile" textValue="Refile photograph">
              <Label>Refile…</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="remove"
              textValue="Remove photograph"
              variant="danger"
            >
              <Label>Remove photograph…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "refile" ? (
        <RefileModal
          photo={photo}
          roster={roster}
          observations={observations}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "remove"}
        onOpenChange={(next) => setOpen(next ? "remove" : null)}
        title={`Remove the photograph of ${photo.dish.label}?`}
        confirmLabel="Remove photograph"
        onConfirm={async () => {
          await removePhotograph({ data: photo.ref });
          toast.success("Photograph removed");
          await router.navigate({
            to: "/experiments/$experiment",
            params: { experiment: photo.ref.experiment },
          });
        }}
      >
        The cell empties. The image stays stored, with its detection and review,
        and can be filed again.
      </DeleteDialog>
    </>
  );
}

function RefileModal({
  photo,
  roster,
  observations,
  onClose,
}: {
  photo: ExperimentPhoto;
  roster: DishStep[];
  observations: ExperimentObservation[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [dish, setDish] = useState(photo.dish.id);
  const [observation, setObservation] = useState(photo.observation.id);

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Refile {photo.filename}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      refilePhotograph({
                        data: { ...photo.ref, dish, observation },
                      }),
                    "Photograph not refiled",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.navigate({
                      to: "/experiments/$experiment/$dish",
                      params: { experiment: photo.ref.experiment, dish },
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
                      selectedKey={dish}
                      onSelectionChange={(key) => setDish(String(key))}
                    >
                      <Label>Dish</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {roster.map((item) => (
                            <ListBox.Item
                              key={item.id}
                              id={item.id}
                              textValue={item.label}
                            >
                              <Label>{item.label}</Label>
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
                      {busy ? "Refiling…" : "Refile"}
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
