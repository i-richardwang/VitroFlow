import { useState } from "react";

import {
  reviewInstances,
  type Review,
  type ReviewVersion,
} from "../../domain/annotation/review";
import type { Model } from "../../domain/models/schema";
import { Workbench } from "../../ui/shell/Workbench";
import { ImageViewport } from "../../ui/viewport/ImageViewport";
import { Editing } from "./Editing";
import { Viewing } from "./Viewing";
import type { LayerKey } from "./controls";
import type { ImageWorkbenchContext } from "./types";

/** One stable frame; viewing and editing own only its contents and action slots. */
export function ImageWorkbench({
  title,
  model,
  review,
  calibrating,
  version = "review",
  onCalibratingChange,
  context = {},
}: {
  title: string;
  model: Model;
  review: Review;
  calibrating: boolean;
  version?: ReviewVersion;
  onCalibratingChange: (calibrating: boolean) => void;
  context?: ImageWorkbenchContext;
}) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(["boxes"]),
  );
  const display = { layers, onLayersChange: setLayers };
  const props = { model, review, display, context };
  return (
    <Workbench title={title}>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
      >
        {calibrating ? (
          <Editing
            {...props}
            opening={reviewInstances(review)}
            onClose={() => onCalibratingChange(false)}
          />
        ) : (
          <Viewing
            {...props}
            version={version}
            onEdit={() => onCalibratingChange(true)}
          />
        )}
      </ImageViewport>
    </Workbench>
  );
}
