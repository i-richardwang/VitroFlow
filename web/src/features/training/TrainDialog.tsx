import { TrainingWorkerSelect } from "./TrainingWorkerSelect";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../functions/training";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import type { TrainingSummary } from "../../domain/training/read-model";
import type {
  TrainingPreset,
  TrainingPresetId,
} from "../../domain/training/recipes";
import { Alert } from "../../ui/kit/Alert";
import { Form } from "../../ui/kit/Form";
import { toast } from "../../ui/kit/Toast";
import { Select } from "../../ui/kit/Select";
import { TrainingParametersForm } from "./TrainingParametersForm";
import {
  type TrainingOverrides,
  trainingOverridesSchema,
} from "../../domain/training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../domain/training/schema";
import { Text } from "../../ui/kit/Text";

const FORM_ID = "train";

/** What starting a run from a training set needs to know. */
interface TrainingSet {
  dataset: string;
  /** How many of its images are reviewed, and so train. */
  reviewed: number;
  trainingPresets: readonly TrainingPreset[];
  defaultTrainingPresetId: TrainingPresetId;
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
  set: { dataset, trainingPresets, defaultTrainingPresetId, training },
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
  const [presetId, setPresetId] = useState(defaultTrainingPresetId);
  const [overrides, setOverrides] = useState<TrainingOverrides>({});
  const preset = trainingPresets.find(
    (candidate) => candidate.id === presetId,
  )!;
  const recipe = preset.recipe;
  const [targetWorkerId, setTargetWorkerId] = useState<string | null>(null);
  const valid = trainingOverridesSchema.safeParse(overrides).success;

  const submit = () => {
    void action
      .run(
        () =>
          startTrainingRun({
            data: { dataset, presetId, overrides, targetWorkerId },
          }),
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
        <TrainingWorkerSelect
          workers={training.workers}
          value={targetWorkerId}
          onChange={setTargetWorkerId}
          disabled={action.busy}
        />
        <Form.Group title={m.train_dialog_preset_title()}>
          <Select
            aria-label={m.train_dialog_preset_title()}
            value={presetId}
            disabled={action.busy}
            options={trainingPresets.map((option) => ({
              value: option.id,
              label: PRESET_PRESENTATION[option.id].label(),
            }))}
            onChange={(id) => {
              setPresetId(id);
              setOverrides({});
            }}
          />
          <Text size="sm" type="secondary">
            {PRESET_PRESENTATION[presetId].description()}
          </Text>
          <Text size="sm" type="secondary">
            {m.train_dialog_recipe({
              model: recipe.baseModel.reference,
              framework: recipe.runtime.framework,
              version: recipe.runtime.version,
            })}
          </Text>
        </Form.Group>
        <TrainingParametersForm
          parameters={recipe.parameters}
          overrides={overrides}
          onChange={setOverrides}
          disabled={action.busy}
        />
        {training.workerMemoryBytes === null ? (
          <Alert type="warning" title={m.train_dialog_no_worker()} />
        ) : null}
      </Form>
    </FormDialog>
  );
}

const PRESET_PRESENTATION: Record<
  TrainingPresetId,
  {
    label: () => string;
    description: () => string;
  }
> = {
  "yolo26n-whole-v1": {
    label: m.train_preset_n,
    description: m.train_preset_n_description,
  },
  "yolo26s-whole-2048-v1": {
    label: m.train_preset_s,
    description: m.train_preset_s_description,
  },
};
