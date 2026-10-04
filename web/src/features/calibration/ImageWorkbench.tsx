import { useState } from "react";

import { openChecks } from "../../domain/annotation/checks";
import {
  availableSources,
  reviewInstances,
  sourceInstances,
  type Review,
} from "../../domain/annotation/review";
import type { ReviewSource } from "../../domain/annotation/schema";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { ToolbarSeparator } from "../../ui/kit/Toolbar";
import { ShellActions } from "../../ui/shell/Shell";
import {
  Workbench,
  WorkbenchAlert,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { ImageViewport } from "../../ui/viewport/ImageViewport";
import { AiSection } from "./AiSection";
import { BoxLayer, ChecksLayer, EditableBoxLayer } from "./BoxLayer";
import { ReviewInspector } from "./ReviewInspector";
import { sourceLabels } from "./labels";
import { useCalibrationSession } from "./session";
import { CalibrationTools } from "./tools";
import type { LayerKey } from "./controls";
import type { ImageWorkbenchContext } from "./types";

/**
 * One frame. It shows one of the image's readings, best by default, and
 * calibration is session state on it that begins from the reading shown.
 * While the AI proposal is in view, or a draft begun from it, the places it
 * asks a person to check are outlined and counted.
 */
export function ImageWorkbench({
  title,
  model,
  review,
  calibrating,
  source,
  onSourceChange,
  onCalibratingChange,
  context = {},
}: {
  title: string;
  model: Model;
  review: Review;
  calibrating: boolean;
  source?: ReviewSource;
  onSourceChange: (source: ReviewSource) => void;
  onCalibratingChange: (calibrating: boolean) => void;
  context?: ImageWorkbenchContext;
}) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(["boxes", "checks"]),
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
  const checks =
    review.proposal && (ready ? ready.origin : shown) === "proposal"
      ? openChecks(review.proposal, instances)
      : [];

  return (
    <Workbench title={title}>
      <ShellActions>
        {calibration.status === "idle" ? (
          <>
            <Button type="primary" onClick={() => onCalibratingChange(true)}>
              {m.calibration_calibrate()}
            </Button>
            {context.actions}
            {context.menu}
          </>
        ) : (
          <>
            <Button disabled={saving} onClick={calibration.close}>
              {m.ui_cancel()}
            </Button>
            <Button
              type="primary"
              loading={calibration.status === "loading" || saving}
              disabled={ready?.conflict != null}
              onClick={ready?.save}
            >
              {saving ? m.calibration_saving() : m.calibration_save()}
            </Button>
            <div inert={saving || undefined} className="contents">
              {context.menu}
            </div>
          </>
        )}
      </ShellActions>
      {ready?.conflict ? (
        <WorkbenchAlert>
          <Alert
            type="warning"
            title={m.calibration_conflict()}
            description={m.calibration_conflict_description()}
            action={
              <Button
                size="small"
                loading={ready.conflict.reloading}
                onClick={ready.conflict.reload}
              >
                {m.calibration_reload()}
              </Button>
            }
          />
        </WorkbenchAlert>
      ) : null}
      {ready ? (
        <WorkbenchToolbar
          label={m.calibration_navigation_and_tools()}
          inert={saving || undefined}
        >
          {context.toolbar}
          {context.toolbar ? <ToolbarSeparator /> : null}
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
            boxClass={ready.boxClass}
            onClassChange={ready.changeClass}
          />
        </WorkbenchToolbar>
      ) : context.toolbar || sources.length > 1 ? (
        <WorkbenchToolbar label={m.calibration_navigation()}>
          {context.toolbar}
          {context.toolbar && sources.length > 1 ? <ToolbarSeparator /> : null}
          {sources.length > 1 ? (
            <ToggleGroup
              aria-label={m.image_boxes_shown()}
              value={shown}
              options={sources.map((item) => ({
                value: item,
                label: sourceLabels[item](),
              }))}
              onChange={onSourceChange}
            />
          ) : null}
        </WorkbenchToolbar>
      ) : null}
      <WorkbenchInspector>
        <AiSection review={review} openChecks={checks.length} />
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
            classes={model.classes}
            instances={ready.instances}
            layers={display.layers}
            tool={ready.tool}
            panning={ready.panning}
            activeClass={ready.activeClass}
            selectedId={ready.selectedId}
            onSelect={ready.setSelectedId}
            onInstancesChange={ready.replaceInstances}
          />
        ) : (
          <BoxLayer
            image={review}
            classes={model.classes}
            instances={instances}
            layers={display.layers}
          />
        )}
        <ChecksLayer image={review} checks={checks} layers={display.layers} />
      </ImageViewport>
    </Workbench>
  );
}
