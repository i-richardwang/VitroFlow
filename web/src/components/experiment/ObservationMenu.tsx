import type { DateValue } from "@internationalized/date";
import {
  Button,
  Dropdown,
  Fieldset,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
  Tooltip,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ExperimentDish } from "../../experiments/contracts";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import {
  editObservation,
  removeObservation,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { DayField, fromDay, toDay } from "./DayField";
import { FilePhotosDialog } from "./FilePhotosDialog";

type Action = "photograph" | "edit" | "delete";

export function ObservationMenu({
  experiment,
  observation,
  dishes,
  photographed,
}: {
  experiment: string;
  observation: ExperimentObservation;
  dishes: ExperimentDish[];
  photographed: ReadonlySet<string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const name = observationLabel(observation);

  return (
    <>
      <Dropdown>
        <Tooltip delay={0} isDisabled={!observation.note}>
          <Button variant="ghost" size="sm" className="-mr-2 font-medium">
            {name}
          </Button>
          <Tooltip.Content>{observation.note}</Tooltip.Content>
        </Tooltip>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={name}
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="photograph" textValue="Add photographs">
              <Label>Add photographs…</Label>
            </Dropdown.Item>
            <Dropdown.Item id="edit" textValue="Edit observation">
              <Label>Edit observation…</Label>
            </Dropdown.Item>
            {!observation.hasRecords ? (
              <Dropdown.Item
                id="delete"
                textValue="Delete observation"
                variant="danger"
              >
                <Label>Delete empty observation…</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "photograph" ? (
        <FilePhotosDialog
          experiment={experiment}
          observation={observation}
          dishes={dishes}
          photographed={photographed}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === "edit" ? (
        <EditObservationModal
          experiment={experiment}
          observation={observation}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(isOpen) => setOpen(isOpen ? "delete" : null)}
        title={`Delete ${name}?`}
        confirmLabel="Delete observation"
        onConfirm={async () => {
          await removeObservation({
            data: { experiment, observation: observation.id },
          });
          toast.success(`${name} deleted`);
          await router.invalidate();
        }}
      >
        Only an observation without photographs or culture events can be
        deleted.
      </DeleteDialog>
    </>
  );
}

function EditObservationModal({
  experiment,
  observation,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observedOn, setObservedOn] = useState<DateValue | null>(() =>
    fromDay(observation.observedOn),
  );

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit observation</Modal.Heading>
              {observation.hasRecords ? (
                <p className="text-sm text-muted">
                  Its date is fixed because the observation has records.
                </p>
              ) : null}
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (observedOn === null) return;
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      editObservation({
                        data: {
                          experiment,
                          observation: observation.id,
                          observedOn: toDay(observedOn),
                          note: String(form.get("note") ?? ""),
                        },
                      }),
                    "Observation not saved",
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
                    <DayField
                      label="Observed"
                      busy={busy || observation.hasRecords}
                      value={observedOn}
                      onChange={setObservedOn}
                    />
                    <TextField
                      variant="secondary"
                      fullWidth
                      isDisabled={busy}
                      name="note"
                      defaultValue={observation.note}
                    >
                      <Label>Note</Label>
                      <Input placeholder="What this observation was for" />
                    </TextField>
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
