import type { DateValue } from "@internationalized/date";
import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { observationLabel } from "../../experiments/schema";
import { createObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
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

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.observation_new()}</Modal.Heading>
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
                    m.observation_not_added(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(
                      m.observation_added({
                        observation: observationLabel(result.value),
                      }),
                    );
                    await router.invalidate();
                    onClose();
                  });
                }}
              >
                <DayField
                  label={m.observation_date_label()}
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
                  <Label>{m.observation_note_label()}</Label>
                  <Input className="w-full" />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="new-observation"
                variant="primary"
                isDisabled={busy}
              >
                {busy
                  ? m.experiment_action_adding()
                  : m.experiment_action_add()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
