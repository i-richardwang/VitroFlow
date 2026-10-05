import { z } from "zod";

import { reviewSchema } from "../annotation/review";
import { detectionFailureSchema } from "../detection/schema";
import { imageDigestSchema } from "../images/schema";
import { tallySchema } from "../models/classes";
import { modelSchema } from "../models/schema";
import {
  cultureEventSchema,
  experimentNameSchema,
  experimentObservationSchema,
  experimentSchema,
  imageAnalysisStateSchema,
  observationIdSchema,
  observationImageIdSchema,
  observationImageRefSchema,
  treatmentIdSchema,
  treatmentNameSchema,
  treatmentSchema,
  unitCodeSchema,
  unitIdSchema,
} from "./schema";

export const unitSchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  treatment: treatmentIdSchema,
  events: z.array(cultureEventSchema),
});

export type Unit = z.infer<typeof unitSchema>;

const observationImageCellSchema = z.strictObject({
  id: observationImageIdSchema,
  unit: unitIdSchema,
  observation: observationIdSchema,
  digest: imageDigestSchema,
  filename: z.string(),
  state: imageAnalysisStateSchema,
  detectionTally: tallySchema.nullable(),
  proposalTally: tallySchema.nullable(),
  annotationTally: tallySchema.nullable(),
  error: z.string().nullable(),
});

export type ObservationImageCell = z.infer<typeof observationImageCellSchema>;

export const experimentGridSchema = z.strictObject({
  experiment: experimentSchema,
  treatments: z.array(treatmentSchema),
  units: z.array(unitSchema),
  observations: z.array(experimentObservationSchema),
  images: z.array(observationImageCellSchema),
});

export type ExperimentGrid = z.infer<typeof experimentGridSchema>;

const unitObservationSchema = z.strictObject({
  observation: experimentObservationSchema,
  image: observationImageCellSchema.nullable(),
});

/** A unit as the series steps through it: enough to name it and its treatment. */
const unitNavigationEntrySchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  treatment: treatmentIdSchema,
});

/** Whether a person has reviewed a photograph's boxes. */
const IMAGE_REVIEWS = ["reviewed", "unreviewed"] as const;

export type ImageReview = (typeof IMAGE_REVIEWS)[number];

/**
 * A unit as the series steps through it on the observation in view, with
 * whether its photograph of that day has been reviewed; a unit without one
 * that day has none.
 */
const unitStepSchema = unitNavigationEntrySchema.extend({
  image: z.enum(IMAGE_REVIEWS).nullable(),
});

export type UnitStep = z.infer<typeof unitStepSchema>;

/**
 * An observation image with its review for the observation's model, and the
 * failure to report when the version that reads for that model could not.
 */
const experimentObservationImageSchema = z.strictObject({
  ref: observationImageRefSchema,
  experimentName: experimentNameSchema,
  unit: unitNavigationEntrySchema,
  observation: experimentObservationSchema,
  model: modelSchema,
  review: reviewSchema,
  failure: detectionFailureSchema.nullable(),
});

export type ExperimentObservationImage = z.infer<
  typeof experimentObservationImageSchema
>;

export const unitSeriesSchema = z.strictObject({
  experiment: experimentSchema,
  unit: unitSchema,
  treatments: z.array(treatmentSchema),
  navigation: z.array(unitStepSchema),
  observations: z.array(unitObservationSchema),
  /** The observation in view: the one asked for, or the newest with a photograph. */
  observation: observationIdSchema.nullable(),
  shown: experimentObservationImageSchema.nullable(),
});

export type UnitSeries = z.infer<typeof unitSeriesSchema>;

export const experimentSummarySchema = z.strictObject({
  experiment: experimentSchema,
  treatmentNames: z.array(treatmentNameSchema),
  latestDay: z.number().int().nullable(),
  counts: z.record(imageAnalysisStateSchema, z.number().int().min(0)),
});

export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
