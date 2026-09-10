import { Button } from "@heroui/react";

import {
  reviewInstances,
  shownInstances,
  type ReviewVersion,
} from "../../domain/annotation/review";
import { m } from "../../paraglide/messages";
import {
  WorkbenchActions,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { BoxLayer } from "./BoxLayer";
import { ReviewInspector } from "./ReviewInspector";
import type { CalibrationViewProps } from "./types";

export function Viewing({
  model,
  review,
  display,
  context,
  version,
  onEdit,
}: CalibrationViewProps & { version: ReviewVersion; onEdit: () => void }) {
  return (
    <>
      <WorkbenchActions>
        <Button
          variant="primary"
          isDisabled={!reviewInstances(review)}
          onPress={onEdit}
        >
          {m.workbench_calibrate()}
        </Button>
        {context.actions}
        {context.menu}
      </WorkbenchActions>
      {context.toolbar ? (
        <WorkbenchToolbar label={m.workbench_navigation()}>
          {context.toolbar}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={review.annotation?.instances ?? null}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      <BoxLayer
        image={review}
        instances={shownInstances(review, version)}
        layers={display.layers}
      />
    </>
  );
}
