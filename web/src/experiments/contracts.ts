import { z } from "zod";

import { annotationSchema } from "../annotation/schema";
import {
  detectionFailureSchema,
  detectionResultSchema,
} from "../detection/schema";
import { resourceIdSchema } from "../identifiers/schema";
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
  observationUnitCodeSchema,
  observationUnitIdSchema,
  treatmentIdSchema,
  treatmentNameSchema,
  treatmentSchema,
} from "./schema";

export const observationUnitSchema = z.strictObject({
  id: observationUnitIdSchema,
  code: observationUnitCodeSchema,
  position: z.number().int().min(1),
  treatment: treatmentIdSchema.nullable(),
  events: z.array(cultureEventSchema),
});

export type ObservationUnit = z.infer<typeof observationUnitSchema>;

/** An observation unit as stored, before display ordering assigns a position. */
export const observationUnitRecordSchema = observationUnitSchema.omit({
  position: true,
});

export type ObservationUnitRecord = z.infer<typeof observationUnitRecordSchema>;

export const observationImageCellSchema = z.strictObject({
  id: observationImageIdSchema,
  observationUnit: observationUnitIdSchema,
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
  observationUnits: z.array(observationUnitSchema),
  observations: z.array(experimentObservationSchema),
  images: z.array(observationImageCellSchema),
});

export type ExperimentGrid = z.infer<typeof experimentGridSchema>;

export const observationUnitObservationSchema = z.strictObject({
  observation: experimentObservationSchema,
  image: observationImageCellSchema.nullable(),
});

export type ObservationUnitObservation = z.infer<
  typeof observationUnitObservationSchema
>;

export const observationUnitNavigationEntrySchema = z.strictObject({
  id: observationUnitIdSchema,
  code: observationUnitCodeSchema,
});

export type ObservationUnitNavigationEntry = z.infer<
  typeof observationUnitNavigationEntrySchema
>;

export const experimentObservationImageSchema = z.strictObject({
  ref: observationImageRefSchema,
  experimentName: experimentNameSchema,
  observationUnit: observationUnitNavigationEntrySchema,
  observation: experimentObservationSchema,
  digest: imageDigestSchema,
  filename: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  blobKey: z.string(),
  modelVersionId: resourceIdSchema,
  modelId: resourceIdSchema,
  detection: detectionResultSchema.nullable(),
  failure: detectionFailureSchema.nullable(),
  annotation: annotationSchema.nullable(),
});

export type ExperimentObservationImage = z.infer<
  typeof experimentObservationImageSchema
>;

export const observationUnitSeriesSchema = z.strictObject({
  experiment: experimentSchema,
  model: modelSchema,
  version: modelVersionSchema,
  observationUnit: observationUnitSchema,
  treatment: treatmentSchema.nullable(),
  navigation: z.array(observationUnitNavigationEntrySchema),
  observations: z.array(observationUnitObservationSchema),
  shown: experimentObservationImageSchema.nullable(),
});

export type ObservationUnitSeries = z.infer<typeof observationUnitSeriesSchema>;

export const experimentSummarySchema = z.strictObject({
  experiment: experimentSchema,
  treatmentNames: z.array(treatmentNameSchema),
  latestDay: z.number().int().nullable(),
  counts: z.record(imageAnalysisStateSchema, z.number().int().min(0)),
});

export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
