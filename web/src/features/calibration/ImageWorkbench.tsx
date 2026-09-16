import { Segment } from "@heroui-pro/react/segment";
import { Button, Separator } from "@heroui/react";
import { useState } from "react";

import {
  availableSources,
  reviewInstances,
  sourceInstances,
  type Review,
  type ReviewSource,
} from "../../domain/annotation/review";
import type { AnnotationRuntimeName } from "../../domain/annotation-runs/schema";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import {
  Workbench,
  WorkbenchActions,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { ImageViewport } from "../../ui/viewport/ImageViewport";
import { AiAnnotateMenu, AiSection } from "./AiAnnotate";
import { BoxLayer, EditableBoxLayer } from "./BoxLayer";
import { ReviewInspector } from "./ReviewInspector";
import { sourceLabels } from "./labels";
import { useCalibrationSession } from "./session";
import { CalibrationTools, DiscardDraftDialog } from "./tools";
import type { LayerKey } from "./controls";
import type { ImageWorkbenchContext } from "./types";

/**
 * One frame. It shows one of the image's readings, best by default, and
 * calibration is session state on it that begins from the reading shown.
 */
export function ImageWorkbench({
  title,
  model,
  review,
  agents,
  calibrating,
  source,
  onSourceChange,
  onCalibratingChange,
  context = {},
}: {
  title: string;
  model: Model;
  review: Review;
  agents: AnnotationRuntimeName[];
  calibrating: boolean;
  source?: ReviewSource;
  onSourceChange: (source: ReviewSource) => void;
  onCalibratingChange: (calibrating: boolean) => void;
  context?: ImageWorkbenchContext;
}) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(["boxes"]),
  );
  const display = { layers, onLayersChange: setLayers };
  const sources = availableSources(review);
  const shown = source && sources.includes(source) ? source : sources[0];
  const calibration = useCalibrationSession({
    calibrating,
    review,
    source: shown,
    model,
    onClose: () => onCalibratingChange(false),
  });
  const ready = calibration.status === "ready" ? calibration : null;
  const saving = ready?.saving === true;
  const instances =
    ready?.instances ??
    (calibration.status === "loading"
      ? reviewInstances(review)
      : ((shown && sourceInstances(review, shown)) ?? []));
  const ai = (
    <AiAnnotateMenu
      review={review}
      model={model}
      agents={agents}
      current={ready ? ready.instances : instances.length ? instances : null}
      disabled={calibration.status === "loading" || saving}
    />
  );

  return (
    <Workbench title={title}>
      <WorkbenchActions>
        {calibration.status === "idle" ? (
          <>
            <Button variant="primary" onPress={() => onCalibratingChange(true)}>
              {m.workbench_calibrate()}
            </Button>
            {ai}
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
              {ai}
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
            sources={ready.sources}
            onRestart={ready.restartFrom}
            classes={model.classes}
            className={ready.className}
            onClassChange={ready.changeClass}
          />
        </WorkbenchToolbar>
      ) : context.toolbar || sources.length > 1 ? (
        <WorkbenchToolbar label={m.workbench_navigation()}>
          {context.toolbar}
          {context.toolbar && sources.length > 1 ? <Separator /> : null}
          {sources.length > 1 ? (
            <Segment
              variant="ghost"
              aria-label={m.image_boxes_shown()}
              selectedKey={shown}
              onSelectionChange={(key) => {
                if (key !== null) onSourceChange(String(key) as ReviewSource);
              }}
            >
              {sources.map((item) => (
                <Segment.Item key={item} id={item}>
                  {sourceLabels[item]()}
                </Segment.Item>
              ))}
            </Segment>
          ) : null}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <AiSection
          review={review}
          model={model}
          agents={agents}
          disabled={saving}
        />
        <ReviewInspector
          model={model}
          review={review}
          draft={ready?.instances ?? null}
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
