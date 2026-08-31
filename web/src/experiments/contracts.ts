import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionFailure, DetectionResult } from "../detection/schema";
import type { Tally } from "../models/readings";
import type { Model, ModelVersion } from "../models/schema";
import type {
  Experiment,
  ExperimentRound,
  PhotoRef,
  PhotoState,
  Treatment,
} from "./schema";

export interface ExperimentDish {
  label: string;
  position: number;
  treatment: string | null;
}

export interface PhotoCell {
  dish: string;
  round: string;
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
  rounds: ExperimentRound[];
  photos: PhotoCell[];
}

export interface DishRound {
  round: ExperimentRound;
  photo: PhotoCell | null;
}

export interface ExperimentDishSeries {
  experiment: Experiment;
  model: Model;
  version: ModelVersion;
  dish: ExperimentDish;
  treatment: Treatment | null;
  previous: string | null;
  next: string | null;
  rounds: DishRound[];
  shown: ExperimentPhoto | null;
}

export interface ExperimentSummary {
  experiment: Experiment;
  version: ModelVersion;
  dishes: number;
  rounds: number;
  counts: Record<PhotoState, number>;
}

export interface ExperimentPhoto {
  ref: PhotoRef;
  experimentName: string;
  round: ExperimentRound;
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
