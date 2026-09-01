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

import type { DateValue } from "@internationalized/date";

import type { ObservationImageCell } from "../../experiments/contracts";
import type { Experiment } from "../../experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { AddToDatasetDialog } from "../dataset/AddToDatasetDialog";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";
import { fromDay, toDay } from "./DayField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

type Action = "dataset" | "edit" | "delete";

export function ExperimentMenu({
  experiment,
  images,
  datasets,
  designLocked,
}: {
  experiment: Experiment;
  images: ObservationImageCell[];
  datasets: string[];
  designLocked: boolean;
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
            {images.length > 0 ? (
              <Dropdown.Item id="dataset" textValue="Add all to dataset">
                <Label>Add all to dataset…</Label>
              </Dropdown.Item>
            ) : null}
            <Separator />
            <Dropdown.Item id="edit" textValue="Edit details">
              <Label>Edit details…</Label>
            </Dropdown.Item>
            {!designLocked ? (
              <Dropdown.Item
                id="delete"
                textValue="Delete experiment"
                variant="danger"
              >
                <Label>Delete draft experiment…</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <AddToDatasetDialog
        isOpen={open === "dataset"}
        images={images.map((image) => ({
          experiment: experiment.id,
          observationImage: image.id,
        }))}
        datasets={datasets}
        heading="Add all to dataset"
        onClose={close}
      />

      <EditExperimentDialog
        experiment={experiment}
        isOpen={open === "edit"}
        protocolLocked={designLocked}
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
        Its design, observation units, and observations are removed. Images stay
        stored, with their detections and reviews, for datasets that use them.
      </DeleteDialog>
    </>
  );
}

function EditExperimentDialog({
  experiment,
  isOpen,
  onClose,
  protocolLocked,
}: {
  experiment: Experiment;
  isOpen: boolean;
  onClose: () => void;
  protocolLocked: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [inoculatedOn, setInoculatedOn] = useState<DateValue | null>(() =>
    fromDay(experiment.inoculatedOn),
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit experiment</Modal.Heading>
              {protocolLocked ? (
                <p className="text-sm text-muted">
                  Plant material, explant type, base medium, and inoculation
                  date are fixed after the first observation.
                </p>
              ) : null}
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (inoculatedOn === null) return;
                  const form = new FormData(event.currentTarget);
                  const fields = readExperimentFields(form);
                  void run(
                    () =>
                      editExperiment({
                        data: {
                          experiment: experiment.id,
                          ...fields,
                          plantMaterial: protocolLocked
                            ? experiment.plantMaterial
                            : fields.plantMaterial,
                          explantType: protocolLocked
                            ? experiment.explantType
                            : fields.explantType,
                          baseMedium: protocolLocked
                            ? experiment.baseMedium
                            : fields.baseMedium,
                          inoculatedOn: protocolLocked
                            ? experiment.inoculatedOn
                            : toDay(inoculatedOn),
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
                    <ExperimentFields
                      busy={busy}
                      defaults={experiment}
                      inoculatedOn={inoculatedOn}
                      onInoculatedOnChange={setInoculatedOn}
                      protocolLocked={protocolLocked}
                    />
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
