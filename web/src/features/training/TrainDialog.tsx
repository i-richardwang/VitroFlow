import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../functions/training";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import type { TrainingConsole } from "../../domain/training/read-model";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";
import { PARAMETER_FIELDS } from "./parameter-fields";
import {
  trainingOverrides,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../domain/training/schema";

const FORM_ID = "train";

/** Why a new run cannot start now, or null when it can. */
export function trainRefusal({ reviewed, training }: TrainingConsole) {
  if (training.active !== null) return m.train_refused_active();
  if (reviewed < MIN_SNAPSHOT_IMAGES) {
    return m.train_refused_reviewed({ count: MIN_SNAPSHOT_IMAGES });
  }
  return null;
}

/** The recipe's parameters, editable before a run is queued. */
export function TrainDialog({
  console,
  open,
  onClose,
}: {
  console: TrainingConsole;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogSession open={open}>
      {(afterClose) => (
        <TrainSession
          console={console}
          open={open}
          onClose={onClose}
          afterClose={afterClose}
        />
      )}
    </DialogSession>
  );
}

function TrainSession({
  console: { dataset, recipe, training },
  open,
  onClose,
  afterClose,
}: {
  console: TrainingConsole;
  open: boolean;
  onClose: () => void;
  afterClose: () => void;
}) {
  const router = useRouter();
  const action = useAsyncAction();
  const [overrides, setOverrides] = useState(() =>
    trainingOverrides(recipe.parameters),
  );
  const valid = trainingOverridesSchema.safeParse(overrides).success;

  const submit = () => {
    void action
      .run(
        () => startTrainingRun({ data: { dataset, overrides } }),
        m.train_not_started(),
      )
      .then(async (result) => {
        if (!result.ok) return;
        onClose();
        toast.success(m.train_queued());
        await router.invalidate();
      });
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.train_dialog_title()}
      okText={m.train_button()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={!valid}
      width="wide"
    >
      <div className="flex flex-col gap-4">
        <Text type="secondary" className="text-sm">
          {m.train_dialog_recipe({
            model: recipe.baseModel.reference,
            framework: recipe.runtime.framework,
            version: recipe.runtime.version,
          })}
        </Text>
        <Form
          id={FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {PARAMETER_FIELDS.map((field) => (
              <Form.Field key={field.key} label={field.label()}>
                <InputNumber
                  value={overrides[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  format={{ maximumFractionDigits: 5 }}
                  disabled={action.busy}
                  onChange={(value) =>
                    setOverrides((current) => ({
                      ...current,
                      [field.key]: value ?? Number.NaN,
                    }))
                  }
                />
              </Form.Field>
            ))}
          </div>
        </Form>
        {training.workerMemoryBytes === null ? (
          <Alert type="warning" title={m.train_dialog_no_worker()} />
        ) : null}
      </div>
    </FormDialog>
  );
}
