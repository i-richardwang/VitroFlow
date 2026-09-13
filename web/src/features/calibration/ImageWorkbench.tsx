import { Button, Separator } from "@heroui/react";
import { useState } from "react";

import {
  reviewInstances,
  shownInstances,
  type Review,
  type ReviewVersion,
} from "../../domain/annotation/review";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import {
  Workbench,
  WorkbenchActions,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { ImageViewport } from "../../ui/viewport/ImageViewport";
import { BoxLayer, EditableBoxLayer } from "./BoxLayer";
import { ReviewInspector } from "./ReviewInspector";
import { useCalibrationSession } from "./session";
import { CalibrationTools, DiscardDraftDialog } from "./tools";
import type { LayerKey } from "./controls";
import type { ImageWorkbenchContext } from "./types";

/** One frame; calibration is session state on it. */
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
  const calibration = useCalibrationSession({
    calibrating,
    review,
    model,
    onClose: () => onCalibratingChange(false),
  });
  const ready = calibration.status === "ready" ? calibration : null;
  const saving = ready?.saving === true;
  const instances =
    ready?.instances ??
    (calibration.status === "loading"
      ? reviewInstances(review)
      : shownInstances(review, version));

  return (
    <Workbench title={title}>
      <WorkbenchActions>
        {calibration.status === "idle" ? (
          <>
            <Button variant="primary" onPress={() => onCalibratingChange(true)}>
              {m.workbench_calibrate()}
            </Button>
            {context.actions}
            {context.menu}
          </>
        ) : (
          <>
            <Button
              variant="tertiary"
              isDisabled={saving}
              onPress={calibration.close}
            >
              {m.cancel()}
            </Button>
            <Button
              variant="primary"
              isPending={calibration.status === "loading" || saving}
              onPress={ready?.save}
            >
              {saving ? m.workbench_saving() : m.workbench_save()}
            </Button>
            <div inert={saving || undefined} className="contents">
              {context.menu}
            </div>
          </>
        )}
      </WorkbenchActions>
      {ready ? (
        <WorkbenchToolbar
          label={m.workbench_navigation_and_tools()}
          inert={saving || undefined}
        >
          {context.toolbar}
          {context.toolbar ? <Separator /> : null}
          <CalibrationTools
            tool={ready.tool}
            history={ready.history}
            canDelete={ready.selectedId !== null}
            onToolChange={ready.setTool}
            onUndo={ready.undo}
            onRedo={ready.redo}
            onDelete={ready.deleteSelected}
            onRestart={ready.restartFromDetection}
            classes={model.classes}
            className={ready.className}
            onClassChange={ready.changeClass}
          />
        </WorkbenchToolbar>
      ) : context.toolbar ? (
        <WorkbenchToolbar label={m.workbench_navigation()}>
          {context.toolbar}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <ReviewInspector
          model={model}
          instances={ready?.instances ?? review.annotation?.instances ?? null}
          detection={review.detection}
          display={display}
          details={context.details}
        />
      </WorkbenchInspector>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
      >
        {ready && !saving ? (
          <EditableBoxLayer
            image={review}
            instances={ready.instances}
            layers={display.layers}
            tool={ready.tool}
            panning={ready.panning}
            className={ready.activeClass}
            selectedId={ready.selectedId}
            onSelect={ready.setSelectedId}
            onInstancesChange={ready.replaceInstances}
          />
        ) : (
          <BoxLayer
            image={review}
            instances={instances}
            layers={display.layers}
          />
        )}
      </ImageViewport>
      {ready?.discard ? (
        <DiscardDraftDialog
          onStay={ready.discard.onStay}
          onLeave={ready.discard.onLeave}
        />
      ) : null}
    </Workbench>
  );
}
