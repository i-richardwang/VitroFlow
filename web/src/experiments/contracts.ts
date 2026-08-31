import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionFailure, DetectionResult } from "../detection/schema";
import type { Tally } from "../models/readings";
import type { Model, ModelVersion } from "../models/schema";
import type {
  DishEvent,
  Experiment,
  ExperimentObservation,
  PhotoRef,
  PhotoState,
  Treatment,
} from "./schema";

export interface ExperimentDish {
  id: string;
  label: string;
  position: number;
  treatment: string | null;
  /** Subsamples within this experimental unit; they do not increase n. */
  initialExplantCount: number;
  events: DishEvent[];
}

export interface PhotoCell {
  id: string;
  dish: string;
  observation: string;
  digest: string;
  filename: string;
  state: PhotoState;
  observed: Tally | null;
  reviewed: Tally | null;
  error: string | null;
}

export interface ExperimentGrid {
  experiment: Experiment;
  model: Model;
  version: ModelVersion;
  treatments: Treatment[];
  dishes: ExperimentDish[];
  observations: ExperimentObservation[];
  photos: PhotoCell[];
}

export interface DishObservation {
  observation: ExperimentObservation;
  photo: PhotoCell | null;
}

export interface DishStep {
  id: string;
  label: string;
}

export interface ExperimentDishSeries {
  experiment: Experiment;
  model: Model;
  version: ModelVersion;
  dish: ExperimentDish;
  treatment: Treatment | null;
  roster: DishStep[];
  observations: DishObservation[];
  shown: ExperimentPhoto | null;
}

export interface ExperimentSummary {
  experiment: Experiment;
  version: ModelVersion;
  treatments: number;
  dishes: number;
  observations: number;
  counts: Record<PhotoState, number>;
}

export interface ExperimentPhoto {
  ref: PhotoRef;
  experimentName: string;
  dish: { id: string; label: string };
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
  label: AnnotationDocument | null;
}
