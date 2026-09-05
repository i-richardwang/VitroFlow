import { z } from "zod";

import { resourceIdSchema } from "../identifiers/schema";
import { imageDigestSchema } from "../images/schema";
import { m } from "../paraglide/messages";

export const experimentIdSchema = z.uuid();
export const observationIdSchema = z.uuid();
export const treatmentIdSchema = z.uuid();
export const observationUnitIdSchema = z.uuid();
export const observationImageIdSchema = z.uuid();

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

export const plantMaterialSchema = z
  .string()
  .trim()
  .max(120, "Plant material must be at most 120 characters");

export const explantTypeSchema = z
  .string()
  .trim()
  .max(120, "Explant type must be at most 120 characters");

export const baseMediumSchema = z
  .string()
  .trim()
  .max(200, "Base medium must be at most 200 characters");

export const experimentNotesSchema = z
  .string()
  .trim()
  .max(2000, "Notes must be at most 2000 characters");

export const treatmentNameSchema = z
  .string()
  .trim()
  .min(1, "Treatment name is required")
  .max(120, "Treatment name must be at most 120 characters");

export const treatmentNoteSchema = z
  .string()
  .trim()
  .max(1000, "Treatment note must be at most 1000 characters");

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

export function formatFactor(factor: TreatmentFactor | null): string {
  if (!factor) return "";
  return `${factor.name} ${factor.level}${factor.unit ? ` ${factor.unit}` : ""}`.trim();
}

export const observationUnitCodeSchema = z
  .string()
  .trim()
  .min(1, "Observation unit code is required")
  .max(60, "Observation unit code must be at most 60 characters");

export const observationNoteSchema = z
  .string()
  .trim()
  .max(500, "Observation note must be at most 500 characters");

export const CULTURE_EVENT_TYPES = [
  "contaminated",
  "nonviable",
  "discarded",
  "harvested",
  "missing",
] as const;

export type CultureEventType = (typeof CULTURE_EVENT_TYPES)[number];

export const cultureEventTypeSchema = z.enum(CULTURE_EVENT_TYPES);

export const experimentSchema = z.strictObject({
  id: experimentIdSchema,
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema,
  explantType: explantTypeSchema,
  baseMedium: baseMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
  modelVersionId: resourceIdSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type Experiment = z.infer<typeof experimentSchema>;

export const experimentRequestSchema = z.strictObject({
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema.default(""),
  explantType: explantTypeSchema.default(""),
  baseMedium: baseMediumSchema.default(""),
  notes: experimentNotesSchema.default(""),
  inoculatedOn: calendarDaySchema,
  modelVersionId: resourceIdSchema,
});

export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export type ExperimentRequestInput = z.input<typeof experimentRequestSchema>;

export const experimentUpdateSchema = z.strictObject({
  experiment: experimentIdSchema,
  name: experimentNameSchema,
  plantMaterial: plantMaterialSchema,
  explantType: explantTypeSchema,
  baseMedium: baseMediumSchema,
  notes: experimentNotesSchema,
  inoculatedOn: calendarDaySchema,
});

export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;

export const experimentRefSchema = z.strictObject({
  experiment: experimentIdSchema,
});

export type ExperimentRef = z.infer<typeof experimentRefSchema>;

export const treatmentSchema = z.strictObject({
  id: treatmentIdSchema,
  name: treatmentNameSchema,
  factor: treatmentFactorSchema.nullable(),
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
  factor: treatmentFactorSchema.nullable().default(null),
  note: treatmentNoteSchema.default(""),
  replicates: z.number().int().min(0).max(200),
});

export type TreatmentRequest = z.infer<typeof treatmentRequestSchema>;

export const treatmentUpdateSchema = treatmentRefSchema.extend({
  name: treatmentNameSchema,
  factor: treatmentFactorSchema.nullable(),
  note: treatmentNoteSchema,
});

export type TreatmentUpdate = z.infer<typeof treatmentUpdateSchema>;

export const observationUnitRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  observationUnit: observationUnitIdSchema,
});

export type ObservationUnitRef = z.infer<typeof observationUnitRefSchema>;

export const observationUnitBatchSchema = z.strictObject({
  experiment: experimentIdSchema,
  treatment: treatmentIdSchema.nullable(),
  codes: z
    .array(observationUnitCodeSchema)
    .min(1, "No observation units to add")
    .max(200),
});

export type ObservationUnitBatch = z.infer<typeof observationUnitBatchSchema>;

export const observationUnitUpdateSchema = observationUnitRefSchema.extend({
  code: observationUnitCodeSchema,
});

export type ObservationUnitUpdate = z.infer<typeof observationUnitUpdateSchema>;

export const observationUnitAssignmentSchema = z.strictObject({
  experiment: experimentIdSchema,
  observationUnits: z.array(observationUnitIdSchema).min(1),
  treatment: treatmentIdSchema.nullable(),
});

export type ObservationUnitAssignment = z.infer<
  typeof observationUnitAssignmentSchema
>;

export const cultureEventIdSchema = z.uuid();

/** Something that happened to a unit, seen at an observation. */
export const cultureEventSchema = z.strictObject({
  id: cultureEventIdSchema,
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
  recordedAt: z.string().datetime({ offset: true }),
});

export type CultureEvent = z.infer<typeof cultureEventSchema>;

export const cultureEventRequestSchema = observationUnitRefSchema.extend({
  type: cultureEventTypeSchema,
  observation: observationIdSchema,
});

export type CultureEventRequest = z.infer<typeof cultureEventRequestSchema>;

export const cultureEventRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  event: cultureEventIdSchema,
});

export type CultureEventRef = z.infer<typeof cultureEventRefSchema>;

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
  return m.observation_day_label({ day: observation.day });
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

export const observationImageRefSchema = z.strictObject({
  experiment: experimentIdSchema,
  observationImage: observationImageIdSchema,
});

export type ObservationImageRef = z.infer<typeof observationImageRefSchema>;

/** The source filename is retained for traceability and is not an identifier. */
const imageFilenameSchema = z
  .string()
  .min(1, "Invalid image filename")
  .max(255, "Invalid image filename")
  .refine(
    (filename) =>
      filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename),
    "Invalid image filename",
  );

export const observationImageAssignmentSchema = z.strictObject({
  experiment: experimentIdSchema,
  observation: observationIdSchema,
  images: z
    .array(
      z.strictObject({
        observationUnit: observationUnitIdSchema,
        digest: imageDigestSchema,
        filename: imageFilenameSchema,
      }),
    )
    .min(1, "No images to assign"),
});

export type ObservationImageAssignment = z.infer<
  typeof observationImageAssignmentSchema
>;

export const observationImageAssignmentResultSchema = z.strictObject({
  observation: experimentObservationSchema,
  assigned: z.number().int().min(0),
});

export type ObservationImageAssignmentResult = z.infer<
  typeof observationImageAssignmentResultSchema
>;

export const observationImageMoveSchema = observationImageRefSchema.extend({
  observationUnit: observationUnitIdSchema,
  observation: observationIdSchema,
});

export type ObservationImageMove = z.infer<typeof observationImageMoveSchema>;

export const observationUnitRequestSchema = observationUnitRefSchema.extend({
  observation: observationIdSchema.optional(),
});

export const IMAGE_ANALYSIS_STATES = ["pending", "failed", "analyzed"] as const;

export const imageAnalysisStateSchema = z.enum(IMAGE_ANALYSIS_STATES);

export type ImageAnalysisState = z.infer<typeof imageAnalysisStateSchema>;
