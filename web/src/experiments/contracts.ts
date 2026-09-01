import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionFailure, DetectionResult } from "../detection/schema";
import type { Tally } from "../models/metrics";
import type { Model, ModelVersion } from "../models/schema";
import type {
  CultureEvent,
  Experiment,
  ExperimentObservation,
  ImageAnalysisState,
  ObservationImageRef,
  Treatment,
} from "./schema";

export interface ObservationUnit {
  id: string;
  code: string;
  position: number;
  treatment: string | null;
  events: CultureEvent[];
}

export interface ObservationImageCell {
  id: string;
  observationUnit: string;
  observation: string;
  digest: string;
  filename: string;
  state: ImageAnalysisState;
  detectionTally: Tally | null;
  annotationTally: Tally | null;
  error: string | null;
}

export interface ExperimentGrid {
  experiment: Experiment;
  model: Model;
  version: ModelVersion;
  treatments: Treatment[];
  observationUnits: ObservationUnit[];
  observations: ExperimentObservation[];
  images: ObservationImageCell[];
}

export interface ObservationUnitObservation {
  observation: ExperimentObservation;
  image: ObservationImageCell | null;
}

export interface ObservationUnitNavigationEntry {
  id: string;
  code: string;
}

export interface ObservationUnitSeries {
  experiment: Experiment;
  model: Model;
  version: ModelVersion;
  observationUnit: ObservationUnit;
  treatment: Treatment | null;
  navigation: ObservationUnitNavigationEntry[];
  observations: ObservationUnitObservation[];
  shown: ExperimentObservationImage | null;
}

export interface ExperimentSummary {
  experiment: Experiment;
  version: ModelVersion;
  treatments: number;
  observationUnits: number;
  observations: number;
  counts: Record<ImageAnalysisState, number>;
}

export interface ExperimentObservationImage {
  ref: ObservationImageRef;
  experimentName: string;
  observationUnit: { id: string; code: string };
  observation: ExperimentObservation;
  digest: string;
  filename: string;
  width: number;
  height: number;
  blobKey: string;
  modelVersionId: string;
  modelId: string;
  detection: DetectionResult | null;
  failure: DetectionFailure | null;
  annotation: AnnotationDocument | null;
}
