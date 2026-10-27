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
  // Omission delegates accumulation to the recipe's pinned runtime.
  nbs: z.number().int().min(1).max(1024).optional(),
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
  scale: z.number().min(0).max(1).optional(),
  degrees: z.number().min(0).max(180).optional(),
  flipud: z.number().min(0).max(1).optional(),
  fliplr: z.number().min(0).max(1).optional(),
  translate: z.number().min(0).max(1).optional(),
  hsv_h: z.number().min(0).max(1).optional(),
  hsv_s: z.number().min(0).max(1).optional(),
  hsv_v: z.number().min(0).max(1).optional(),
});

export type TrainingParameters = z.infer<typeof trainingParametersSchema>;

/** The parameters a run may change from the recipe; the rest stay as recorded. */
export const trainingOverridesSchema = trainingParametersSchema
  .pick({
    epochs: true,
    imgsz: true,
    batch: true,
    patience: true,
    lr0: true,
    warmup_epochs: true,
    nbs: true,
  })
  .partial();

export type TrainingOverrides = z.infer<typeof trainingOverridesSchema>;
