import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { dishLabelKey } from "./naming";

export const experimentIdSchema = z.uuid();
export const observationIdSchema = z.uuid();
export const treatmentIdSchema = z.uuid();
export const dishIdSchema = z.uuid();
export const photoIdSchema = z.uuid();

/** A calendar day in the notebook, without a clock or a time zone. */
function calendarParts(day: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
    ? [year, month, date]
    : null;
}

export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((day) => calendarParts(day) !== null, "Invalid date");

export type CalendarDay = z.infer<typeof calendarDaySchema>;

/** Whole days between two calendar days, counted on the civil calendar. */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  const [fromYear, fromMonth, fromDate] = calendarParts(from)!;
  const [toYear, toMonth, toDate] = calendarParts(to)!;
  const start = Date.UTC(fromYear, fromMonth - 1, fromDate);
  const end = Date.UTC(toYear, toMonth - 1, toDate);
  return Math.round((end - start) / 86_400_000);
}

export const experimentNameSchema = z
  .string()
  .trim()
  .min(1, "Experiment name is required")
  .max(120, "Experiment name must be at most 120 characters");

export const experimentMaterialSchema = z
  .string()
  .trim()
  .max(120, "Material must be at most 120 characters");

export const experimentExplantSchema = z
  .string()
  .trim()
  .max(120, "Explant must be at most 120 characters");

export const experimentMediumSchema = z
  .string()
  .trim()
  .max(200, "Medium must be at most 200 characters");

export const experimentNotesSchema = z
  .string()
  .trim()
  .max(2000, "Notes must be at most 2000 characters");

export const treatmentNameSchema = z
  .string()
  .trim()
  .min(1, "Treatment name is required")
  .max(120, "Treatment name must be at most 120 characters")
  .refine((name) => dishLabelKey(name).length > 0, "Invalid treatment name");

export const treatmentNoteSchema = z
  .string()
  .trim()
  .max(1000, "Treatment note must be at most 1000 characters");

/**
 * One thing a treatment sets: a growth regulator and its dose, a light
 * regime, a temperature. Levels are recorded as written, so `1.0` and `low`
 * are equally sayable, and treatments that set the same factors compare.
 */
export const treatmentFactorSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Factor name is required")
    .max(60, "Factor name must be at most 60 characters"),
  level: z
    .string()
    .trim()
    .min(1, "Factor level is required")
    .max(60, "Factor level must be at most 60 characters"),
  unit: z.string().trim().max(20, "Unit must be at most 20 characters"),
});

export type TreatmentFactor = z.infer<typeof treatmentFactorSchema>;

export const treatmentFactorsSchema = z
  .array(treatmentFactorSchema)
  .max(12, "A treatment sets at most 12 factors")
  .superRefine((factors, context) => {
    const names = factors.map((factor) => factor.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: "custom", message: "Factors must be distinct" });
    }
  });

export function formatFactors(factors: readonly TreatmentFactor[]): string {
  return factors
    .map((factor) =>
      `${factor.name} ${factor.level}${factor.unit ? ` ${factor.unit}` : ""}`.trim(),
    )
    .join(" + ");
}

export const dishLabelSchema = z
  .string()
  .trim()
  .min(1, "Dish label is required")
  .max(60, "Dish label must be at most 60 characters")
  .refine((label) => dishLabelKey(label).length > 0, "Invalid dish label");

export const dishNoteSchema = z
  .string()
  .trim()
  .max(500, "Dish note must be at most 500 characters");

export const initialExplantCountSchema = z
  .number()
  .int()
  .min(1, "Each dish needs at least one explant")
  .max(10_000, "Initial explant count must be at most 10,000");

export const observationNoteSchema = z
  .string()
  .trim()
  .max(500, "Observation note must be at most 500 characters");

export const DISH_EVENT_TYPES = [
  "contaminated",
  "dead",
  "discarded",
  "harvested",
  "lost",
] as const;

export type DishEventType = (typeof DISH_EVENT_TYPES)[number];

export const dishEventTypeSchema = z.enum(DISH_EVENT_TYPES);

export const experimentSchema = z.strictObject({
  id: experimentIdSchema,
  name: experimentNameSchema,
  material: experimentMaterialSchema,
  explant: experimentExplantSchema,
  medium: experimentMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
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
  inoculatedOn: calendarDaySchema,
  modelVersionId: resourceIdSchema,
});

export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export type ExperimentRequestInput = z.input<typeof experimentRequestSchema>;

export const experimentUpdateSchema = z.strictObject({
  experiment: experimentIdSchema,
  name: experimentNameSchema,
  material: experimentMaterialSchema,
  explant: experimentExplantSchema,
  medium: experimentMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
});

export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;

export const experimentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
});

export type ExperimentRef = z.infer<typeof experimentRefSchema>;

/**
 * A treatment is what an experiment varies: the dishes that share a
 * condition are its replicates, and results are compared treatment by
 * treatment. Factors state the condition; a treatment that declares none is
 * described by its name and note alone.
 */
export const treatmentSchema = z.strictObject({
  id: treatmentIdSchema,
  name: treatmentNameSchema,
  factors: treatmentFactorsSchema,
  note: treatmentNoteSchema,
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
  factors: treatmentFactorsSchema.default([]),
  note: treatmentNoteSchema.default(""),
  replicates: z.number().int().min(0).max(200).default(0),
  initialExplantCount: initialExplantCountSchema.default(1),
});

export type TreatmentRequest = z.infer<typeof treatmentRequestSchema>;

export const treatmentUpdateSchema = treatmentRefSchema.extend({
  name: treatmentNameSchema,
  factors: treatmentFactorsSchema,
  note: treatmentNoteSchema,
});

export type TreatmentUpdate = z.infer<typeof treatmentUpdateSchema>;

export const dishRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  dish: dishIdSchema,
});

export type DishRef = z.infer<typeof dishRefSchema>;

export const dishLayoutSchema = z.strictObject({
  experiment: experimentIdSchema,
  treatment: treatmentIdSchema.nullable(),
  labels: z.array(dishLabelSchema).min(1, "No dishes to add").max(200),
  initialExplantCount: initialExplantCountSchema.default(1),
});

export type DishLayout = z.infer<typeof dishLayoutSchema>;

export const dishUpdateSchema = dishRefSchema.extend({
  label: dishLabelSchema,
  initialExplantCount: initialExplantCountSchema,
});

export type DishUpdate = z.infer<typeof dishUpdateSchema>;

export const dishAssignmentSchema = z.strictObject({
  experiment: experimentIdSchema,
  dishes: z.array(dishIdSchema).min(1),
  treatment: treatmentIdSchema.nullable(),
});

export type DishAssignment = z.infer<typeof dishAssignmentSchema>;

export const treatmentReplicatesSchema = treatmentRefSchema.extend({
  replicates: z.number().int().min(1).max(200),
  initialExplantCount: initialExplantCountSchema,
});

export type TreatmentReplicates = z.infer<typeof treatmentReplicatesSchema>;

export const dishEventIdSchema = z.uuid();

export const dishEventSchema = z.strictObject({
  id: dishEventIdSchema,
  type: dishEventTypeSchema,
  observation: observationIdSchema,
  excludeFromObservation: z.boolean(),
  removeAfterObservation: z.boolean(),
  note: dishNoteSchema,
  recordedAt: z.string().datetime({ offset: true }),
  voidedAt: z.string().datetime({ offset: true }).nullable(),
  voidReason: dishNoteSchema,
});

export type DishEvent = z.infer<typeof dishEventSchema>;

export const dishEventRequestSchema = dishRefSchema.extend({
  type: dishEventTypeSchema,
  observation: observationIdSchema,
  excludeFromObservation: z.boolean(),
  removeAfterObservation: z.boolean(),
  note: dishNoteSchema,
});

export type DishEventRequest = z.infer<typeof dishEventRequestSchema>;

export const dishEventVoidSchema = z.strictObject({
  experiment: experimentIdSchema,
  event: dishEventIdSchema,
  reason: dishNoteSchema.min(1, "A correction reason is required"),
});

export type DishEventVoid = z.infer<typeof dishEventVoidSchema>;

export const experimentObservationSchema = z.strictObject({
  id: observationIdSchema,
  ordinal: z.number().int().min(1),
  observedOn: calendarDaySchema,
  day: z.number().int(),
  note: observationNoteSchema,
  hasRecords: z.boolean(),
});

export type ExperimentObservation = z.infer<typeof experimentObservationSchema>;

export function observationLabel(observation: ExperimentObservation): string {
  return `Day ${observation.day}`;
}

export const observationRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
});

export type ObservationRef = z.infer<typeof observationRefSchema>;

export const observationRequestSchema = z.strictObject({
  experiment: experimentIdSchema,
  observedOn: calendarDaySchema,
  note: observationNoteSchema.default(""),
});

export type ObservationRequest = z.infer<typeof observationRequestSchema>;

export const observationUpdateSchema = observationRefSchema.extend({
  observedOn: calendarDaySchema,
  note: observationNoteSchema,
});

export type ObservationUpdate = z.infer<typeof observationUpdateSchema>;

export const photoRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  photo: photoIdSchema,
});

export type PhotoRef = z.infer<typeof photoRefSchema>;

/**
 * A photograph's filename is where it came from, kept for tracing it back to
 * the camera. It identifies nothing: the dish it shows is the dish it was
 * filed under.
 */
const photoFilenameSchema = z
  .string()
  .min(1, "Invalid photo filename")
  .max(255, "Invalid photo filename")
  .refine(
    (filename) =>
      filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename),
    "Invalid photo filename",
  );

export const photoFilingSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
  photos: z
    .array(
      z.strictObject({
        dish: dishIdSchema,
        digest: imageDigestSchema,
        filename: photoFilenameSchema,
      }),
    )
    .min(1, "No photographs to file"),
});

export type PhotoFiling = z.infer<typeof photoFilingSchema>;

export interface FilingResult {
  observation: ExperimentObservation;
  photos: number;
}

export const photoMoveSchema = photoRefSchema.extend({
  dish: dishIdSchema,
  observation: observationIdSchema,
});

export type PhotoMove = z.infer<typeof photoMoveSchema>;

export const dishRequestSchema = dishRefSchema.extend({
  observation: observationIdSchema.optional(),
});

export const PHOTO_STATES = ["pending", "failed", "observed"] as const;

export type PhotoState = (typeof PHOTO_STATES)[number];
