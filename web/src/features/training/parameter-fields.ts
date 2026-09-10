import { z } from "zod";

import {
  trainingOverridesSchema,
  type TrainingParameters,
  type TrainingOverrides,
} from "../../domain/training/parameters";
import { m } from "../../paraglide/messages";

export const PARAMETER_LABELS: Record<keyof TrainingParameters, () => string> =
  {
    epochs: m.parameter_epochs,
    patience: m.parameter_patience,
    batch: m.parameter_batch,
    imgsz: m.parameter_imgsz,
    optimizer: m.parameter_optimizer,
    lr0: m.parameter_lr0,
    warmup_epochs: m.parameter_warmup_epochs,
    mosaic: m.parameter_mosaic,
    mixup: m.parameter_mixup,
    copy_paste: m.parameter_copy_paste,
    max_det: m.parameter_max_det,
    seed: m.parameter_seed,
    deterministic: m.parameter_deterministic,
  };

export interface ParameterField {
  key: keyof TrainingOverrides;
  label: () => string;
  min: number;
  max: number;
  step: number;
}

/** The schema supplies validation bounds; only interaction steps are UI choices. */
const properties = z.toJSONSchema(trainingOverridesSchema).properties!;
const FIELD_STEPS = {
  epochs: 1,
  imgsz: 32,
  batch: 1,
  patience: 1,
  lr0: 0.00001,
} satisfies Record<keyof TrainingOverrides, number>;
export const PARAMETER_FIELDS: ParameterField[] = (
  Object.keys(FIELD_STEPS) as Array<keyof TrainingOverrides>
).map((key) => {
  const property = properties[key]!;
  if (
    typeof property === "boolean" ||
    property.minimum === undefined ||
    property.maximum === undefined
  )
    throw new Error(`Training field ${key} requires numeric bounds`);
  return {
    key,
    label: PARAMETER_LABELS[key],
    min: property.minimum,
    max: property.maximum,
    step: FIELD_STEPS[key],
  };
});
