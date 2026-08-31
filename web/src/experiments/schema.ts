import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";

export const experimentIdSchema = z.uuid();
export const roundIdSchema = z.uuid();
export const treatmentIdSchema = z.uuid();

export const experimentNameSchema = z
  .string()
  .trim()
  .min(1, "Experiment name is required")
  .max(120, "Experiment name must be at most 120 characters");

/** The plant under culture: species, cultivar, or line. */
export const experimentMaterialSchema = z
  .string()
  .trim()
  .max(120, "Material must be at most 120 characters");

/** The tissue the dishes were started from. */
export const experimentExplantSchema = z
  .string()
  .trim()
  .max(120, "Explant must be at most 120 characters");

/** The base medium every treatment shares. */
export const experimentMediumSchema = z
  .string()
  .trim()
  .max(200, "Medium must be at most 200 characters");

/** The rest of the notebook page: conditions, goals, remarks. */
export const experimentNotesSchema = z
  .string()
  .trim()
  .max(2000, "Notes must be at most 2000 characters");

export const treatmentNameSchema = z
  .string()
  .trim()
  .min(1, "Treatment name is required")
  .max(120, "Treatment name must be at most 120 characters");

/** How this condition differs from the others: the recipe, dose, or setting. */
export const treatmentDescriptionSchema = z
  .string()
  .trim()
  .max(1000, "Treatment description must be at most 1000 characters");

export const roundLabelSchema = z
  .string()
  .trim()
  .min(1, "Round label is required")
  .max(80, "Round label must be at most 80 characters");

export const experimentSchema = z.strictObject({
  id: experimentIdSchema,
  name: experimentNameSchema,
  material: experimentMaterialSchema,
  explant: experimentExplantSchema,
  medium: experimentMediumSchema,
  notes: experimentNotesSchema,
  modelVersionId: resourceIdSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type Experiment = z.infer<typeof experimentSchema>;

export const experimentRequestSchema = z.strictObject({
  name: experimentNameSchema,
  material: experimentMaterialSchema.default(""),
  explant: experimentExplantSchema.default(""),
  medium: experimentMediumSchema.default(""),
  notes: experimentNotesSchema.default(""),
  modelVersionId: resourceIdSchema,
});

export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export type ExperimentRequestInput = z.input<typeof experimentRequestSchema>;

/** The words of an experiment may change; its version and dishes may not. */
export const experimentUpdateSchema = z.strictObject({
  experiment: experimentIdSchema,
  name: experimentNameSchema,
  material: experimentMaterialSchema,
  explant: experimentExplantSchema,
  medium: experimentMediumSchema,
  notes: experimentNotesSchema,
});

export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;

/** One experiment resource addressed by a workbench route. */
export const experimentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
});

export type ExperimentRef = z.infer<typeof experimentRefSchema>;

export const experimentRoundSchema = z.strictObject({
  id: roundIdSchema,
  label: roundLabelSchema,
  capturedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});

export type ExperimentRound = z.infer<typeof experimentRoundSchema>;

export const roundRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  round: roundIdSchema,
});

export type RoundRef = z.infer<typeof roundRefSchema>;

export const roundUpdateSchema = roundRefSchema.extend({
  label: roundLabelSchema,
  capturedAt: z.string().datetime({ offset: true }),
});

export type RoundUpdate = z.infer<typeof roundUpdateSchema>;

/**
 * A treatment is what an experiment varies: the dishes that share a
 * condition are its replicates, and results are compared treatment by
 * treatment. Treatments are named and ordered as the notebook lists them.
 */
export const treatmentSchema = z.strictObject({
  id: treatmentIdSchema,
  name: treatmentNameSchema,
  description: treatmentDescriptionSchema,
  position: z.number().int().min(1),
});

export type Treatment = z.infer<typeof treatmentSchema>;

export const treatmentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  treatment: treatmentIdSchema,
});

export type TreatmentRef = z.infer<typeof treatmentRefSchema>;

export const treatmentRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  name: treatmentNameSchema,
  description: treatmentDescriptionSchema.default(""),
});

export type TreatmentRequest = z.infer<typeof treatmentRequestSchema>;

export const treatmentUpdateSchema = treatmentRefSchema.extend({
  name: treatmentNameSchema,
  description: treatmentDescriptionSchema,
});

export type TreatmentUpdate = z.infer<typeof treatmentUpdateSchema>;

const dishLabelSchema = z.string().min(1).max(255);

/** One dish of an experiment: a row of the grid, photographed round by round. */
export const dishRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  dish: dishLabelSchema,
});

export type DishRef = z.infer<typeof dishRefSchema>;

/** Which treatment the dishes replicate; none returns them to the unassigned rows. */
export const dishAssignmentSchema = z.strictObject({
  experiment: experimentIdSchema,
  dishes: z.array(dishLabelSchema).min(1),
  treatment: treatmentIdSchema.nullable(),
});

export type DishAssignment = z.infer<typeof dishAssignmentSchema>;

/** One dish in one round: the cell of the grid a photograph fills. */
export const photoRefSchema = dishRefSchema.extend({ round: roundIdSchema });

export type PhotoRef = z.infer<typeof photoRefSchema>;

/** A dish page shows one of its rounds; without a choice, the newest. */
export const dishRequestSchema = dishRefSchema.extend({
  round: roundIdSchema.optional(),
});

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

export interface RoundResult {
  round: ExperimentRound;
  photos: number;
}

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
export const PHOTO_STATES = ["pending", "failed", "observed"] as const;

export type PhotoState = (typeof PHOTO_STATES)[number];
