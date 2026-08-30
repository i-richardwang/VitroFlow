import { z } from "zod";

import { imageDigestSchema } from "../datasets/schema";
import { versionIdSchema } from "../inference/schema";

export const experimentIdSchema = z.uuid();
export const roundIdSchema = z.uuid();

export const experimentNameSchema = z
  .string()
  .trim()
  .min(1, "Experiment name is required")
  .max(120, "Experiment name must be at most 120 characters");

export const roundLabelSchema = z
  .string()
  .trim()
  .min(1, "Round label is required")
  .max(80, "Round label must be at most 80 characters");

export const experimentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: experimentIdSchema,
  name: experimentNameSchema,
  modelVersionId: versionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type Experiment = z.infer<typeof experimentSchema>;

export const experimentRequestSchema = z.strictObject({
  name: experimentNameSchema,
  modelVersionId: versionIdSchema,
});

/** One experiment resource addressed by a workbench route. */
export const experimentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
});

export const experimentRoundSchema = z.strictObject({
  id: roundIdSchema,
  label: roundLabelSchema,
  capturedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});

export type ExperimentRound = z.infer<typeof experimentRoundSchema>;

const dishLabelSchema = z.string().min(1).max(255);

/** One dish in one round: the cell of the grid a photograph fills. */
export const photoRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  dish: dishLabelSchema,
  round: roundIdSchema,
});

export type PhotoRef = z.infer<typeof photoRefSchema>;

const photoFilenameSchema = z
  .string()
  .min(1, "Invalid photo filename")
  .max(255, "Invalid photo filename")
  .refine(
    (filename) =>
      filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename),
    "Invalid photo filename",
  );

/** Stored photographs and business metadata for one captured occasion. */
export const roundRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  label: roundLabelSchema,
  capturedAt: z.string().datetime({ offset: true }),
  photos: z
    .array(
      z.strictObject({
        digest: imageDigestSchema,
        filename: photoFilenameSchema,
      }),
    )
    .min(1, "No photos in the round"),
});

export type RoundRequest = z.infer<typeof roundRequestSchema>;

/**
 * The dish a photograph shows is the normalized name it was saved under,
 * without the extension: `A3.jpg` in every round is dish `A3`.
 */
export function dishLabel(filename: string): string {
  const normalized = filename.normalize("NFC");
  const dot = normalized.lastIndexOf(".");
  const stem = dot > 0 ? normalized.slice(0, dot) : normalized;
  return stem.trim();
}

/** Roster order: numbers inside labels compare by value, so `A2` precedes `A10`. */
export function compareDishLabels(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

/** What the experiment knows about one cell of its grid. */
export const PHOTO_STATES = ["pending", "failed", "counted"] as const;

export type PhotoState = (typeof PHOTO_STATES)[number];
