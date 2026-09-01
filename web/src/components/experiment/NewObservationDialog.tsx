import type { DateValue } from "@internationalized/date";
import {
  Button,
  Description,
  Fieldset,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  daysBetween,
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import { createObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { currentDay, DayField, fromDay, toDay } from "./DayField";

export function NewObservationDialog({
  experiment,
  inoculatedOn,
  isOpen,
  onClose,
  onCreated,
}: {
  experiment: string;
  inoculatedOn: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (observation: ExperimentObservation) => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observedOn, setObservedOn] = useState<DateValue | null>(currentDay);
  const day = observedOn ? daysBetween(inoculatedOn, toDay(observedOn)) : null;

  if (!isOpen) return null;

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New observation</Modal.Heading>
              <Description>
                {day === null
                  ? "The day the observation units were examined."
                  : `Inoculated on ${inoculatedOn}, so this is day ${day}.`}
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (observedOn === null) return;
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      createObservation({
                        data: {
                          experiment,
                          observedOn: toDay(observedOn),
                          note: String(form.get("note") ?? ""),
                        },
                      }),
                    "Observation not added",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(`${observationLabel(result.value)} added`);
                    await router.invalidate();
                    onCreated(result.value);
                  });
                }}
              >
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <DayField
                      label="Observation date"
                      busy={busy}
                      value={observedOn}
                      minValue={fromDay(inoculatedOn)}
                      onChange={setObservedOn}
                    />
                    <TextField
                      variant="secondary"
                      fullWidth
                      isDisabled={busy}
                      name="note"
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
                      {busy ? "Adding…" : "Add"}
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
