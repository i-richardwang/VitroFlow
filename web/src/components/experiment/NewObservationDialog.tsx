import type { DateValue } from "@internationalized/date";
import {
  Button,
  Description,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { daysBetween, observationLabel } from "../../experiments/schema";
import { createObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { currentDay, DayField, fromDay, toDay } from "./DayField";

export function NewObservationDialog({
  experiment,
  inoculatedOn,
  isOpen,
  onClose,
}: {
  experiment: string;
  inoculatedOn: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [observedOn, setObservedOn] = useState<DateValue | null>(currentDay);
  const day = observedOn ? daysBetween(inoculatedOn, toDay(observedOn)) : null;

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New observation</Modal.Heading>
              <Description>
                {day === null
                  ? "A date on the experiment calendar."
                  : `Day ${day}`}
              </Description>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="new-observation"
                className="flex w-full min-w-0 flex-col gap-4"
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
                    onClose();
                  });
                }}
              >
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
                  <Input
                    className="w-full"
                    placeholder="What this observation was for"
                  />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="new-observation"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Adding…" : "Add"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
