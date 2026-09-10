import type { Review } from "../annotation/review";
import type { Model } from "../models/schema";
import type { ImageSplit } from "../training/schema";
import type { Dataset } from "./schema";

/** A neighbour in the dataset's order, for stepping through its images. */
export interface DatasetImageStep {
  digest: string;
  filename: string;
}

/** One dataset image with its review, and the images either side of it. */
export interface DatasetImageView {
  dataset: Dataset;
  model: Model;
  review: Review;
  split: ImageSplit | null;
  previous: DatasetImageStep | null;
  next: DatasetImageStep | null;
}
