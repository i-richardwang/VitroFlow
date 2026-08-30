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

import { ImageBatchForm, postJson } from "../ImageBatchForm";
import type { ExperimentRound } from "../../experiments/schema";

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Adds one round of photographs. The first round decides which dishes the
 * experiment follows; every later one photographs those dishes again.
 */
export function RoundDialog({
  experiment,
  firstRound,
}: {
  experiment: string;
  firstRound: boolean;
}) {
  return (
    <Modal>
      <Button variant="primary">
        {firstRound ? "First round" : "New round"}
      </Button>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            {({ close }) => (
              <>
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
                  <ImageBatchForm
                    fields={(busy) => (
                      <Fieldset.Group>
                        <TextField
                          fullWidth
                          isRequired
                          isDisabled={busy}
                          name="label"
                        >
                          <Label>Round label</Label>
                          <Input placeholder="Day 1" />
                          <FieldError />
                        </TextField>
                        <TextField
                          fullWidth
                          isRequired
                          isDisabled={busy}
                          name="capturedAt"
                          type="datetime-local"
                          defaultValue={localDateTimeValue(new Date())}
                        >
                          <Label>Captured at</Label>
                          <Input />
                          <FieldError />
                        </TextField>
                      </Fieldset.Group>
                    )}
                    submitLabel="Add round"
                    busyLabel="Adding…"
                    onSubmit={async (photos, form) => {
                      const capturedAt = new Date(
                        String(form.get("capturedAt") ?? ""),
                      );
                      if (Number.isNaN(capturedAt.getTime())) {
                        throw new Error("Captured at is invalid");
                      }
                      const { round, photos: count } = await postJson<{
                        round: ExperimentRound;
                        photos: number;
                      }>(
                        `/api/experiments/${encodeURIComponent(experiment)}/rounds`,
                        {
                          label: String(form.get("label") ?? ""),
                          capturedAt: capturedAt.toISOString(),
                          photos,
                        },
                      );
                      return `${round.label} added with ${count} ${count === 1 ? "photo" : "photos"}`;
                    }}
                    onComplete={close}
                  />
                </Modal.Body>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
