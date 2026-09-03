import {
  Button,
  Dropdown,
  Form,
  Label,
  Modal,
  Separator,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { DateValue } from "@internationalized/date";

import type { ObservationImageCell } from "../../experiments/contracts";
import type { Experiment } from "../../experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { AddToDatasetDialog } from "../dataset/AddToDatasetDialog";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { Hint } from "../Hint";
import { MoreIcon } from "../icons";
import { fromDay, toDay } from "./DayField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

type Action = "dataset" | "edit" | "delete";

export function ExperimentMenu({
  experiment,
  images,
  datasets,
  hasRecords,
  onAddUnits,
}: {
  experiment: Experiment;
  images: ObservationImageCell[];
  datasets: string[];
  hasRecords: boolean;
  onAddUnits: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      <Dropdown>
        <Hint text="Experiment actions">
          <Button variant="ghost" isIconOnly aria-label="Experiment actions">
            <MoreIcon />
          </Button>
        </Hint>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Experiment actions"
            onAction={(key) => {
              const id = String(key);
              if (id === "units") {
                onAddUnits();
                return;
              }
              setOpen(id as Action);
            }}
          >
            <Dropdown.Item id="units" textValue="Add observation units">
              <Label>Add observation units…</Label>
            </Dropdown.Item>
            {images.length > 0 ? (
              <Dropdown.Item id="dataset" textValue="Add all to dataset">
                <Label>Add all to dataset…</Label>
              </Dropdown.Item>
            ) : null}
            <Separator orientation="horizontal" />
            <Dropdown.Item id="edit" textValue="Edit details">
              <Label>Edit details…</Label>
            </Dropdown.Item>
            {!hasRecords ? (
              <Dropdown.Item
                id="delete"
                textValue="Delete experiment"
                variant="danger"
              >
                <Label>Delete experiment…</Label>
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
        onClose={close}
      />

      <DestructiveActionDialog
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
        Images stay stored.
      </DestructiveActionDialog>
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
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="edit-experiment"
                className="flex w-full min-w-0 flex-col gap-4"
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
                          inoculatedOn: toDay(inoculatedOn),
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
                <ExperimentFields
                  busy={busy}
                  defaults={experiment}
                  inoculatedOn={inoculatedOn}
                  onInoculatedOnChange={setInoculatedOn}
                />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="edit-experiment"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
