import type { DateValue } from "@internationalized/date";
import {
  Button,
  Dropdown,
  Form,
  Input,
  Label,
  Modal,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ObservationUnit } from "../../experiments/contracts";
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
import { Hint } from "../Hint";
import { MoreIcon } from "../icons";
import { AssignImagesDialog } from "./AssignImagesDialog";
import { DayField, fromDay, toDay } from "./DayField";

type Action = "images" | "edit" | "delete";

export function ObservationMenu({
  experiment,
  observation,
  observationUnits,
  assigned,
}: {
  experiment: string;
  observation: ExperimentObservation;
  observationUnits: ObservationUnit[];
  assigned: ReadonlySet<string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const name = observationLabel(observation);

  return (
    <>
      <Dropdown>
        <Hint text={`${name} actions`}>
          <Button
            variant="ghost"
            isIconOnly
            size="sm"
            aria-label={`${name} actions`}
          >
            <MoreIcon />
          </Button>
        </Hint>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={name}
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="images" textValue="Assign images">
              <Label>Assign images…</Label>
            </Dropdown.Item>
            <Dropdown.Item id="edit" textValue="Edit observation">
              <Label>Edit observation…</Label>
            </Dropdown.Item>
            {!observation.hasRecords ? (
              <>
                <Separator orientation="horizontal" />
                <Dropdown.Item
                  id="delete"
                  textValue="Delete observation"
                  variant="danger"
                >
                  <Label>Delete empty observation…</Label>
                </Dropdown.Item>
              </>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <AssignImagesDialog
        experiment={experiment}
        observation={observation}
        observationUnits={observationUnits}
        assigned={assigned}
        isOpen={open === "images"}
        onClose={() => setOpen(null)}
      />

      <EditObservationModal
        experiment={experiment}
        observation={observation}
        isOpen={open === "edit"}
        onClose={() => setOpen(null)}
      />

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
      />
    </>
  );
}

function EditObservationModal({
  experiment,
  observation,
  isOpen,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observedOn, setObservedOn] = useState<DateValue | null>(() =>
    fromDay(observation.observedOn),
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit observation</Modal.Heading>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="edit-observation"
                className="flex w-full min-w-0 flex-col gap-4"
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
                <DayField
                  label="Observation date"
                  busy={busy}
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
                  <Input className="w-full" />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="edit-observation"
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
