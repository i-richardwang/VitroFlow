import type { DateValue } from "@internationalized/date";
import { getLocalTimeZone, now } from "@internationalized/date";
import {
  Button,
  Description,
  FieldError,
  Fieldset,
  Input,
  Label,
  Modal,
  TextField,
} from "@heroui/react";
import { useState } from "react";

import { createRound } from "../../functions/experiments";
import { CapturedAtField, toInstant } from "./CapturedAtField";
import { RoundForm } from "./RoundForm";

export function RoundDialog({
  experiment,
  firstRound,
}: {
  experiment: string;
  firstRound: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        {firstRound ? "First round" : "New round"}
      </Button>
      {open ? (
        <AddRoundModal
          experiment={experiment}
          firstRound={firstRound}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AddRoundModal({
  experiment,
  firstRound,
  onClose,
}: {
  experiment: string;
  firstRound: boolean;
  onClose: () => void;
}) {
  const [capturedAt, setCapturedAt] = useState<DateValue | null>(() =>
    now(getLocalTimeZone()),
  );

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {firstRound ? "Photograph the dishes" : "Photograph again"}
              </Modal.Heading>
              <Description>
                {firstRound
                  ? "One photo per dish, named after the dish: A1.jpg is dish A1. These names become the rows of the experiment."
                  : "One photo per dish, named as in the first round. Dishes not photographed this time stay empty for this round."}
              </Description>
            </Modal.Header>
            <Modal.Body>
              <RoundForm
                fields={(busy) => (
                  <Fieldset.Group>
                    <TextField
                      variant="secondary"
                      fullWidth
                      isRequired
                      isDisabled={busy}
                      name="label"
                    >
                      <Label>Round label</Label>
                      <Input placeholder="Day 1" />
                      <FieldError />
                    </TextField>
                    <CapturedAtField
                      busy={busy}
                      value={capturedAt}
                      onChange={setCapturedAt}
                    />
                  </Fieldset.Group>
                )}
                submitLabel="Add round"
                busyLabel="Adding…"
                onCancel={onClose}
                onSubmit={async (photos, form) => {
                  if (capturedAt == null) {
                    throw new Error("Captured at is required");
                  }
                  const { round, photos: count } = await createRound({
                    data: {
                      experiment,
                      label: String(form.get("label") ?? ""),
                      capturedAt: toInstant(capturedAt).toISOString(),
                      photos,
                    },
                  });
                  return `${round.label} added with ${count} ${count === 1 ? "photo" : "photos"}`;
                }}
                onComplete={onClose}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
