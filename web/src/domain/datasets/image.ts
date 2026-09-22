import type { Review } from "../annotation/review";
import type { Model } from "../models/schema";
import type { ImageSplit } from "../training/schema";
import type { Dataset } from "./schema";

export interface DatasetImageStep {
  digest: string;
  filename: string;
}

export interface DatasetImageView {
  dataset: Dataset;
  model: Model;
  review: Review;
  split: ImageSplit | null;
  previous: DatasetImageStep | null;
  next: DatasetImageStep | null;
}
