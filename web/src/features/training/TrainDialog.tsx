import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../functions/training";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import type { TrainingSummary } from "../../domain/training/read-model";
import type { TrainingRecipe } from "../../domain/training/schema";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { InputNumber } from "../../ui/kit/Input";
import { toast } from "../../ui/kit/Toast";
import { PARAMETER_FIELD_GROUPS } from "./parameter-fields";
import {
  trainingOverrides,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../domain/training/schema";

const FORM_ID = "train";

/** What starting a run from a training set needs to know. */
interface TrainingSet {
  dataset: string;
  /** How many of its images are reviewed, and so train. */
  reviewed: number;
  recipe: TrainingRecipe;
  training: TrainingSummary;
}

/** Why a new run cannot start now, or null when it can. */
export function trainRefusal({
  reviewed,
  training,
}: Pick<TrainingSet, "reviewed" | "training">) {
  if (training.active !== null) return m.train_refused_active();
  if (reviewed < MIN_SNAPSHOT_IMAGES) {
    return m.train_refused_reviewed({ count: MIN_SNAPSHOT_IMAGES });
  }
  return null;
}

/** The recipe's parameters, editable before a run is queued. */
export function TrainDialog({
  set,
  open,
  onClose,
}: {
  set: TrainingSet;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogSession open={open}>
      {(afterClose) => (
        <TrainSession
          set={set}
          open={open}
          onClose={onClose}
          afterClose={afterClose}
        />
      )}
    </DialogSession>
  );
}

function TrainSession({
  set: { dataset, recipe, training },
  open,
  onClose,
  afterClose,
}: {
  set: TrainingSet;
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
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Form.Group title={m.train_dialog_recipe_title()}>
          <div className="text-xs text-fg-secondary">
            {m.train_dialog_recipe({
              model: recipe.baseModel.reference,
              framework: recipe.runtime.framework,
              version: recipe.runtime.version,
            })}
          </div>
        </Form.Group>
        {PARAMETER_FIELD_GROUPS.map((group) => (
          <Form.Group key={group.key} title={group.title()}>
            <div className="grid gap-4 mobile:grid-cols-2">
              {group.fields.map((field) => (
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
          </Form.Group>
        ))}
        {training.workerMemoryBytes === null ? (
          <Alert type="warning" title={m.train_dialog_no_worker()} />
        ) : null}
      </Form>
    </FormDialog>
  );
}
