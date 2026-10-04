import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ExperimentObservation } from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import {
  createObservation,
  editObservation,
} from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  useAsyncAction,
  type AsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Input } from "../../ui/kit/Input";
import { currentDay, DayField, fromDay, toDay } from "./DayField";
import { ModelField } from "./ModelField";

const FORM_ID = "observation";

type ObservationDialogProps = {
  experiment: string;
  inoculatedOn: string;
  models: readonly Model[];
  open: boolean;
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
  const { open, onClose } = props;
  const action = useAsyncAction();
  const editing = props.observation !== null;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={editing ? m.observation_edit() : m.observation_new()}
      okText={editing ? m.experiment_action_save() : m.experiment_action_add()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ObservationForm {...props} action={action} />
    </FormDialog>
  );
}

function ObservationForm(
  props: ObservationDialogProps & { action: AsyncAction },
) {
  const { experiment, inoculatedOn, models, action, onClose } = props;
  const router = useRouter();
  const editing = props.observation !== null;
  const [observedOn, setObservedOn] = useState(() =>
    editing ? fromDay(props.observation.observedOn) : currentDay(),
  );
  const [note, setNote] = useState(editing ? props.observation.note : "");
  const [modelId, setModelId] = useState(() =>
    editing
      ? props.observation.modelId
      : (props.previous?.modelId ?? models[0]!.id),
  );

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        const value = {
          experiment,
          observedOn: toDay(observedOn),
          note,
          modelId,
        };
        void action
          .run(
            () =>
              editing
                ? editObservation({
                    data: { ...value, observation: props.observation.id },
                  })
                : createObservation({ data: value }),
            editing ? m.observation_not_saved() : m.observation_not_added(),
          )
          .then(async (result) => {
            if (!result.ok) return;
            onClose();
            await router.invalidate();
          });
      }}
    >
      <DayField
        label={m.observation_date_label()}
        disabled={action.busy}
        value={observedOn}
        minDate={fromDay(inoculatedOn)}
        onChange={setObservedOn}
      />
      <ModelField
        disabled={action.busy}
        models={models}
        value={modelId}
        onChange={setModelId}
      />
      <Form.Field label={m.observation_note_label()}>
        <Input disabled={action.busy} value={note} onValueChange={setNote} />
      </Form.Field>
    </Form>
  );
}
