import { z } from "zod";

import { reviewSchema } from "../annotation/review";
import { detectionFailureSchema } from "../detection/schema";
import { imageDigestSchema } from "../images/schema";
import { tallySchema } from "../models/metrics";
import { modelSchema, modelVersionSchema } from "../models/schema";
import {
  cultureEventSchema,
  experimentNameSchema,
  experimentObservationSchema,
  experimentSchema,
  imageAnalysisStateSchema,
  observationIdSchema,
  observationImageIdSchema,
  observationImageRefSchema,
  unitCodeSchema,
  unitIdSchema,
  treatmentIdSchema,
  treatmentNameSchema,
  treatmentSchema,
} from "./schema";

export const unitSchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
  position: z.number().int().min(1),
  treatment: treatmentIdSchema,
  events: z.array(cultureEventSchema),
});

export type Unit = z.infer<typeof unitSchema>;

/** A unit as stored, before display ordering assigns a position. */
export const unitRecordSchema = unitSchema.omit({
  position: true,
});

export type UnitRecord = z.infer<typeof unitRecordSchema>;

export const observationImageCellSchema = z.strictObject({
  id: observationImageIdSchema,
  unit: unitIdSchema,
  observation: observationIdSchema,
  digest: imageDigestSchema,
  filename: z.string(),
  state: imageAnalysisStateSchema,
  detectionTally: tallySchema.nullable(),
  annotationTally: tallySchema.nullable(),
  error: z.string().nullable(),
});

export type ObservationImageCell = z.infer<typeof observationImageCellSchema>;

export const experimentGridSchema = z.strictObject({
  experiment: experimentSchema,
  model: modelSchema,
  version: modelVersionSchema,
  treatments: z.array(treatmentSchema),
  units: z.array(unitSchema),
  observations: z.array(experimentObservationSchema),
  images: z.array(observationImageCellSchema),
});

export type ExperimentGrid = z.infer<typeof experimentGridSchema>;

export const unitObservationSchema = z.strictObject({
  observation: experimentObservationSchema,
  image: observationImageCellSchema.nullable(),
});

export type UnitObservation = z.infer<typeof unitObservationSchema>;

export const unitNavigationEntrySchema = z.strictObject({
  id: unitIdSchema,
  code: unitCodeSchema,
});

export type UnitNavigationEntry = z.infer<typeof unitNavigationEntrySchema>;

/**
 * An observation image with its review for the experiment's model. The
 * detection the review carries is the experiment version's, the one every
 * metric on the experiment is read from.
 */
export const experimentObservationImageSchema = z.strictObject({
  ref: observationImageRefSchema,
  experimentName: experimentNameSchema,
  unit: unitNavigationEntrySchema,
  observation: experimentObservationSchema,
  review: reviewSchema,
  failure: detectionFailureSchema.nullable(),
});

export type ExperimentObservationImage = z.infer<
  typeof experimentObservationImageSchema
>;

export const unitSeriesSchema = z.strictObject({
  experiment: experimentSchema,
  model: modelSchema,
  version: modelVersionSchema,
  unit: unitSchema,
  treatments: z.array(treatmentSchema),
  navigation: z.array(unitNavigationEntrySchema),
  observations: z.array(unitObservationSchema),
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
