import {
  Button,
  Dropdown,
  Fieldset,
  Form,
  Label,
  Modal,
  Separator,
  toast,
  Tooltip,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { PhotoCell } from "../../experiments/contracts";
import type { Experiment, Treatment } from "../../experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { AddToDatasetDialog } from "../dataset/AddToDatasetDialog";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";
import { TreatmentsDialog } from "./TreatmentsDialog";

type Action = "treatments" | "dataset" | "edit" | "delete";

export function ExperimentMenu({
  experiment,
  treatments,
  photos,
  datasets,
}: {
  experiment: Experiment;
  treatments: Treatment[];
  photos: PhotoCell[];
  datasets: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      <Dropdown>
        <Tooltip delay={0}>
          <Button variant="ghost" isIconOnly aria-label="Experiment actions">
            <MoreIcon />
          </Button>
          <Tooltip.Content>Actions</Tooltip.Content>
        </Tooltip>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Experiment actions"
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="treatments" textValue="Treatments">
              <Label>Treatments…</Label>
            </Dropdown.Item>
            {photos.length > 0 ? (
              <Dropdown.Item id="dataset" textValue="Add all to dataset">
                <Label>Add all to dataset…</Label>
              </Dropdown.Item>
            ) : null}
            <Separator />
            <Dropdown.Item id="edit" textValue="Edit details">
              <Label>Edit details…</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="delete"
              textValue="Delete experiment"
              variant="danger"
            >
              <Label>Delete experiment…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <TreatmentsDialog
        experiment={experiment.id}
        treatments={treatments}
        isOpen={open === "treatments"}
        onClose={close}
      />

      <AddToDatasetDialog
        isOpen={open === "dataset"}
        photos={photos.map((photo) => ({
          experiment: experiment.id,
          dish: photo.dish,
          round: photo.round,
        }))}
        datasets={datasets}
        heading="Add all to dataset"
        onClose={close}
      />

      <EditExperimentDialog
        experiment={experiment}
        isOpen={open === "edit"}
        onClose={close}
      />

      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={`Delete ${experiment.name}?`}
        confirmLabel="Delete experiment"
        onConfirm={async () => {
          await removeExperiment({ data: { experiment: experiment.id } });
          toast.success(`${experiment.name} deleted`);
          await router.navigate({ to: "/experiments" });
        }}
      >
        Its treatments, dishes, and rounds are removed. The photographs stay
        stored, with their detections and reviews, for the datasets that use
        them.
      </DeleteDialog>
    </>
  );
}

function EditExperimentDialog({
  experiment,
  isOpen,
  onClose,
}: {
  experiment: Experiment;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit experiment</Modal.Heading>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      editExperiment({
                        data: {
                          experiment: experiment.id,
                          ...readExperimentFields(form),
                        },
                      }),
                    "Experiment not saved",
                  ).then(async (result) => {
                    if (result.ok) {
                      onClose();
                      await router.invalidate();
                    }
                  });
                }}
              >
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <ExperimentFields busy={busy} defaults={experiment} />
                  </Fieldset.Group>
                  <Fieldset.Actions>
                    <Button variant="tertiary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Saving…" : "Save"}
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
