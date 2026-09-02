import { z } from "zod";

const OPTIMIZERS = [
  "auto",
  "SGD",
  "Adam",
  "AdamW",
  "NAdam",
  "RAdam",
  "RMSProp",
] as const;

/**
 * The Ultralytics training arguments a run fixes. Every run records the full
 * set, so a version's training is reproducible from its manifest alone.
 */
export const trainingParametersSchema = z.strictObject({
  epochs: z.number().int().min(1).max(300),
  patience: z.number().int().min(0).max(300),
  batch: z.number().int().min(1).max(64),
  imgsz: z
    .number()
    .int()
    .min(320)
    .max(2048)
    .multipleOf(32, "Image size must be a multiple of 32"),
  optimizer: z.enum(OPTIMIZERS),
  lr0: z.number().min(0.00001).max(0.1),
  warmup_epochs: z.number().min(0).max(10),
  mosaic: z.number().min(0).max(1),
  mixup: z.number().min(0).max(1),
  copy_paste: z.number().min(0).max(1),
  max_det: z.number().int().min(1).max(10000),
  seed: z.number().int().min(0),
  deterministic: z.boolean(),
});

export type TrainingParameters = z.infer<typeof trainingParametersSchema>;

/** The parameters a run may change from the recipe; the rest stay as recorded. */
export const trainingOverridesSchema = trainingParametersSchema.pick({
  epochs: true,
  imgsz: true,
  batch: true,
  patience: true,
  lr0: true,
});

export type TrainingOverrides = z.infer<typeof trainingOverridesSchema>;

export function trainingOverrides(
  parameters: TrainingParameters,
): TrainingOverrides {
  return {
    epochs: parameters.epochs,
    imgsz: parameters.imgsz,
    batch: parameters.batch,
    patience: parameters.patience,
    lr0: parameters.lr0,
  };
}

export interface ParameterField {
  key: keyof TrainingOverrides;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Bounds mirror `trainingParametersSchema`, which stays the validator. */
export const PARAMETER_FIELDS: ParameterField[] = [
  { key: "epochs", label: "Epochs", min: 1, max: 300, step: 1 },
  { key: "imgsz", label: "Image size", min: 320, max: 2048, step: 32 },
  { key: "batch", label: "Batch", min: 1, max: 64, step: 1 },
  { key: "patience", label: "Patience", min: 0, max: 300, step: 1 },
  { key: "lr0", label: "Learning rate", min: 0.00001, max: 0.1, step: 0.00001 },
];
