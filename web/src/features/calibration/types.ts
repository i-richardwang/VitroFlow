import type { ReactNode } from "react";

import type { Model } from "../../domain/models/schema";
import type { Review } from "../../domain/annotation/review";
import type { LayerKey } from "./controls";

/** What a page adds around the image. */
export interface ImageWorkbenchContext {
  actions?: ReactNode;
  menu?: ReactNode;
  toolbar?: ReactNode;
  details?: ReactNode;
}
export interface Display {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
}
export interface CalibrationViewProps {
  model: Model;
  review: Review;
  display: Display;
  context: ImageWorkbenchContext;
}
