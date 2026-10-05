import type { ReactNode } from "react";

import type { Review } from "../../domain/annotation/review";
import { sourceInstances } from "../../domain/annotation/review";
import type { ReviewSource } from "../../domain/annotation/schema";
import {
  classCount,
  count,
  tally,
  type Tally,
} from "../../domain/models/classes";
import { m } from "../../paraglide/messages";
import { QualityAlert } from "../../ui/DetectionQuality";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Progress } from "../../ui/kit/Progress";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { formatCount, formatNumber } from "../../ui/numbers";
import { Stepper } from "../../ui/Stepper";
import { WorkbenchSection } from "../../ui/shell/Workbench";
import { ClassLabel } from "./controls";
import { sourceLabels } from "./labels";

/**
 * How many of each class the boxes on view hold, and their total, which is
 * the number the image gives its unit. When the image has more than one
 * reading, they are offered side by side with their totals; picking one
 * shows its boxes.
 */
export function CountsSection({
  classes,
  counts,
  review,
  sources,
  shown,
  onSourceChange,
}: {
  classes: string[];
  counts: Tally;
  review: Review;
  sources: ReviewSource[];
  shown: ReviewSource | null;
  onSourceChange: (source: ReviewSource) => void;
}) {
  return (
    <WorkbenchSection title={m.annotation_section_metrics()}>
      <div className="text-3xl font-semibold tabular-nums">
        {formatCount(count(counts))}
      </div>
      {classes.length > 1 ? (
        <Descriptions>
          {classes.map((name) => (
            <DescriptionsItem
              key={name}
              label={<ClassLabel classes={classes} name={name} />}
            >
              <span className="block text-end tabular-nums">
                {formatCount(classCount(counts, name))}
              </span>
            </DescriptionsItem>
          ))}
        </Descriptions>
      ) : null}
      {sources.length > 1 ? (
        <div className="pt-2">
          <ToggleGroup
            aria-label={m.annotation_readings()}
            variant="outlined"
            value={shown ?? undefined}
            options={sources.map((source) => ({
              value: source,
              label: m.annotation_named_count({
                name: sourceLabels[source](),
                count: count(tally(sourceInstances(review, source) ?? [])),
              }),
            }))}
            onChange={onSourceChange}
          />
        </div>
      ) : null}
    </WorkbenchSection>
  );
}

/**
 * The agent's part: the progress of a run still at work, and the places its
 * proposal asks a person to look at, stepped through one at a time.
 */
export function ChecksSection({
  review,
  checks,
  at,
  onStep,
}: {
  review: Review;
  /** How many of the proposal's checks remain open against the boxes on view. */
  checks: number;
  /** The check last brought into view, if any. */
  at: number | null;
  onStep: (index: number) => void;
}) {
  const { progress } = review;
  if (!progress && checks === 0) return null;
  return (
    <WorkbenchSection title={m.annotation_ai_section()}>
      {progress ? (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg-secondary">
              {m.annotation_ai_running()}
            </span>
            <span className="tabular-nums">
              {m.annotation_ai_progress_count({
                completed: progress.completed,
                total: progress.total,
              })}
            </span>
          </div>
          <Progress
            value={progress.completed}
            max={progress.total}
            aria-label={m.annotation_ai_progress()}
          />
        </div>
      ) : null}
      {checks > 0 ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-fg-secondary">{m.annotation_ai_checks()}</span>
          <Stepper
            previous={{
              label: m.annotation_check_previous(),
              onClick: () => onStep(at === null ? checks - 1 : at - 1),
            }}
            next={{
              label: m.annotation_check_next(),
              onClick: () => onStep(at === null ? 0 : at + 1),
            }}
          >
            <span className="font-medium text-warning">
              {at === null
                ? formatCount(checks)
                : m.ui_step_position({ index: at + 1, total: checks })}
            </span>
          </Stepper>
        </div>
      ) : null}
    </WorkbenchSection>
  );
}

/** What the image is: the page's own facts about it, its file, and what read it. */
export function DetailsSection({
  review,
  facts,
}: {
  review: Review;
  facts?: ReactNode;
}) {
  const { detection } = review;
  const threshold = detection?.diagnostics?.metrics?.confidence_threshold;
  return (
    <WorkbenchSection title={m.annotation_details()}>
      <Descriptions>
        {facts}
        <DescriptionsItem label={m.annotation_file()}>
          {review.filename}
        </DescriptionsItem>
        {detection ? (
          <DescriptionsItem label={m.annotation_detection_version()}>
            {detection.producer.modelVersionId}
          </DescriptionsItem>
        ) : null}
        {threshold === undefined ? null : (
          <DescriptionsItem label={m.annotation_detection_threshold()}>
            {formatNumber(threshold)}
          </DescriptionsItem>
        )}
      </Descriptions>
      {detection ? <QualityAlert quality={detection.quality} /> : null}
    </WorkbenchSection>
  );
}
