import { useState } from "react";

import { openChecks } from "../../domain/annotation/checks";
import { availableSources, type Review } from "../../domain/annotation/review";
import type { ReviewSource } from "../../domain/annotation/schema";
import { tally } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { Status, type StatusTone } from "../../ui/kit/Status";
import { ShellActions } from "../../ui/shell/Shell";
import {
  Workbench,
  WorkbenchAlert,
  WorkbenchInspector,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import {
  ImageViewport,
  type ViewportFocus,
} from "../../ui/viewport/ImageViewport";
import { ChecksLayer, EditableBoxLayer } from "./BoxLayer";
import type { LayerKey } from "./controls";
import { ChecksSection, CountsSection, DetailsSection } from "./inspector";
import { useStepKeys } from "./keys";
import { useImageSession, type Standing } from "./session";
import { EditTools, LayerControls } from "./tools";
import type { ImageWorkbenchContext } from "./types";

const STANDING: Record<Standing, { tone: StatusTone; label: () => string }> = {
  edited: { tone: "warning", label: m.annotation_standing_edited },
  reviewed: { tone: "success", label: m.annotation_standing_reviewed },
  proposal: { tone: "info", label: m.annotation_standing_proposal },
  detection: { tone: "info", label: m.annotation_standing_detection },
  unread: { tone: "neutral", label: m.annotation_standing_unread },
};

/**
 * One image and its boxes, open for review as soon as it shows. The boxes
 * begin as the reading on view, the best one unless another is picked, and
 * any edit begins a draft. Confirming stores the boxes as the image's review
 * and, when the page names one, moves on to the next image still to review.
 * Where an AI proposal is on view, the places it asks a person to check are
 * outlined, counted and stepped through.
 */
export function ImageWorkbench({
  title,
  model,
  review,
  source,
  onSourceChange,
  onNext,
  context = {},
}: {
  title: string;
  model: Model;
  review: Review;
  source?: ReviewSource;
  /** Shows another reading; none returns to the best. */
  onSourceChange: (source: ReviewSource | undefined) => void;
  /** Opens the next image still to review, when there is one. */
  onNext?: () => void;
  context?: ImageWorkbenchContext;
}) {
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(["boxes", "checks"]),
  );
  const sources = availableSources(review);
  const shown =
    source && sources.includes(source) ? source : (sources[0] ?? null);
  const session = useImageSession({ review, shown, model });
  const { standing, saving, instances } = session;
  const checks =
    review.proposal && session.origin === "proposal"
      ? openChecks(review.proposal, instances)
      : [];
  // Each step brings its check into view again, even one already there.
  const [visit, setVisit] = useState<{ at: number; count: number } | null>(
    null,
  );
  const checkAt = visit && visit.at < checks.length ? visit.at : null;
  const focus: ViewportFocus | null =
    checkAt === null
      ? null
      : { key: String(visit!.count), region: checks[checkAt]!.bbox };
  const stepCheck = (index: number) =>
    setVisit((previous) => ({
      at: (index + checks.length) % checks.length,
      count: (previous?.count ?? 0) + 1,
    }));

  const confirm = async () => {
    if (await session.confirm()) {
      if (onNext) onNext();
      else onSourceChange(undefined);
    }
  };
  const reviewed = standing === "reviewed";
  const primary = reviewed
    ? onNext && { label: m.annotation_next_unreviewed(), run: onNext }
    : {
        label: onNext ? m.annotation_confirm_next() : m.annotation_confirm(),
        run: confirm,
      };
  useStepKeys({
    Enter:
      primary && !saving && !session.conflict
        ? () => void primary.run()
        : undefined,
  });
  const badge = STANDING[standing];

  return (
    <Workbench title={title}>
      <ShellActions>
        <Status tone={badge.tone}>{badge.label()}</Status>
        {standing === "edited" ? (
          <Button type="text" disabled={saving} onClick={session.discard}>
            {m.annotation_discard_edits()}
          </Button>
        ) : null}
        {primary ? (
          <Button
            type="primary"
            loading={saving}
            disabled={session.conflict !== null}
            onClick={() => void primary.run()}
          >
            {primary.label}
          </Button>
        ) : null}
        <div inert={saving || undefined} className="contents">
          {context.menu}
        </div>
      </ShellActions>
      {session.conflict ? (
        <WorkbenchAlert>
          <Alert
            type="warning"
            title={m.annotation_conflict()}
            description={m.annotation_conflict_description()}
            action={
              <Button size="small" onClick={session.conflict.reload}>
                {m.annotation_reload()}
              </Button>
            }
          />
        </WorkbenchAlert>
      ) : null}
      {context.alert ? <WorkbenchAlert>{context.alert}</WorkbenchAlert> : null}
      <WorkbenchToolbar label={m.annotation_box_class()} inert={saving}>
        <EditTools
          classes={model.classes}
          tally={tally(instances)}
          boxClass={session.boxClass}
          onClassChange={session.changeClass}
          history={session.history}
          onUndo={session.undo}
          onRedo={session.redo}
          canDelete={session.selectedId !== null}
          onDelete={session.deleteSelected}
        />
      </WorkbenchToolbar>
      {context.steps}
      <WorkbenchInspector>
        <CountsSection
          classes={model.classes}
          counts={tally(instances)}
          review={review}
          sources={sources}
          shown={shown}
          onSourceChange={onSourceChange}
        />
        <ChecksSection
          review={review}
          checks={checks.length}
          at={checkAt}
          onStep={stepCheck}
        />
        {context.sections}
        <DetailsSection review={review} facts={context.facts} />
      </WorkbenchInspector>
      <ImageViewport
        image={{
          digest: review.ref.digest,
          width: review.width,
          height: review.height,
        }}
        filename={review.filename}
        focus={focus}
        controls={
          <LayerControls
            available={
              review.proposal ? ["boxes", "ids", "checks"] : ["boxes", "ids"]
            }
            layers={layers}
            onLayersChange={setLayers}
          />
        }
      >
        <EditableBoxLayer
          image={review}
          classes={model.classes}
          instances={instances}
          layers={layers}
          panning={session.panning || saving}
          activeClass={session.activeClass}
          selectedId={session.selectedId}
          onSelect={session.setSelectedId}
          onClassChange={session.changeClass}
          onInstancesChange={session.replaceInstances}
        />
        <ChecksLayer image={review} checks={checks} layers={layers} />
      </ImageViewport>
    </Workbench>
  );
}
