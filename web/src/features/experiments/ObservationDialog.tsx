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

import { observationLabel } from "./labels";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import {
  createObservation,
  editObservation,
} from "../../functions/experiments";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { currentDay, DayField, fromDay, toDay } from "./DayField";
import { ModelSelect } from "./ModelSelect";
import type { Model } from "../../domain/models/schema";

/** What the form collects: when the experiment was observed and how it is read. */
interface ObservationDraft {
  observedOn: DateValue | null;
  note: string;
  modelId: string;
}

type ObservationDialogProps = {
  experiment: string;
  inoculatedOn: string;
  models: readonly Model[];
  isOpen: boolean;
  onClose: () => void;
} & (
  | {
      observation: null;
      /** The observation a new one continues from, if any. */
      previous: ExperimentObservation | undefined;
    }
  | { observation: ExperimentObservation }
);

/** Creates an observation, or edits one: the same page of the notebook. */
export function ObservationDialog(props: ObservationDialogProps) {
  const { experiment, inoculatedOn, models, isOpen, onClose } = props;
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const editing = props.observation !== null;
  const initial: ObservationDraft = editing
    ? {
        observedOn: fromDay(props.observation.observedOn),
        note: props.observation.note,
        modelId: props.observation.modelId,
      }
    : {
        observedOn: currentDay(),
        note: "",
        modelId: props.previous?.modelId ?? models[0]!.id,
      };

  const submit = (draft: ObservationDraft) => {
    if (draft.observedOn === null) return;
    const value = {
      experiment,
      observedOn: toDay(draft.observedOn),
      note: draft.note,
      modelId: draft.modelId,
    };
    void run(
      () =>
        editing
          ? editObservation({
              data: { ...value, observation: props.observation.id },
            })
          : createObservation({ data: value }),
      editing ? m.observation_not_saved() : m.observation_not_added(),
    ).then(async (result) => {
      if (!result.ok) return;
      if (!editing) {
        toast.success(
          m.observation_added({
            observation: observationLabel(result.value),
          }),
        );
      }
      onClose();
      await router.invalidate();
    });
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>
                {editing ? m.observation_edit() : m.observation_new()}
              </Modal.Heading>
            </Modal.Header>
            <ObservationEditor
              key={isOpen ? "open" : "closed"}
              busy={busy}
              models={models}
              initial={initial}
              minDate={fromDay(inoculatedOn)}
              submitLabel={
                editing
                  ? busy
                    ? m.experiment_action_saving()
                    : m.experiment_action_save()
                  : busy
                    ? m.experiment_action_adding()
                    : m.experiment_action_add()
              }
              onSubmit={submit}
              onClose={onClose}
            />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ObservationEditor({
  busy,
  models,
  initial,
  minDate,
  submitLabel,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  models: readonly Model[];
  initial: ObservationDraft;
  minDate: DateValue;
  submitLabel: string;
  onSubmit: (draft: ObservationDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <Modal.Body>
        <Form
          id="observation"
          className="flex w-full min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(draft);
          }}
        >
          <DayField
            label={m.observation_date_label()}
            busy={busy}
            value={draft.observedOn}
            minValue={minDate}
            onChange={(observedOn) => setDraft({ ...draft, observedOn })}
          />
          <ModelSelect
            busy={busy}
            models={models}
            value={draft.modelId}
            onChange={(modelId) => setDraft({ ...draft, modelId })}
          />
          <TextField
            variant="secondary"
            fullWidth
            isDisabled={busy}
            value={draft.note}
            onChange={(note) => setDraft({ ...draft, note })}
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
          form="observation"
          variant="primary"
          isDisabled={busy}
        >
          {submitLabel}
        </Button>
      </Modal.Footer>
    </>
  );
}
