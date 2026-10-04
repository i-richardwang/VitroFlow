import type { Review } from "../../domain/annotation/review";
import { m } from "../../paraglide/messages";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Progress } from "../../ui/kit/Progress";
import { formatCount } from "../../ui/readings";
import { WorkbenchSection } from "../../ui/shell/Workbench";
import { Timestamp } from "../../ui/Timestamp";

/**
 * The agent's reading of this image: the progress of a run at work, and the
 * proposal last left with how many places it still asks a person to look at.
 */
export function AiSection({
  review,
  openChecks,
}: {
  review: Review;
  /** How many of the proposal's checks remain open against the boxes in view. */
  openChecks: number;
}) {
  const { progress, proposal } = review;
  if (!progress && !proposal) return null;
  return (
    <WorkbenchSection title={m.calibration_ai_section()}>
      {progress ? (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg-secondary">
              {m.calibration_ai_running()}
            </span>
            <span className="tabular-nums">
              {m.calibration_ai_progress_count({
                completed: formatCount(progress.completed),
                total: formatCount(progress.total),
              })}
            </span>
          </div>
          <Progress
            value={progress.completed}
            max={progress.total}
            aria-label={m.calibration_ai_progress()}
          />
        </div>
      ) : null}
      {proposal ? (
        <p className="text-sm text-fg-secondary">
          <Timestamp value={proposal.createdAt} />
        </p>
      ) : null}
      {openChecks > 0 ? (
        <Descriptions>
          <DescriptionsItem label={m.calibration_ai_checks()}>
            <span className="font-medium text-warning tabular-nums">
              {formatCount(openChecks)}
            </span>
          </DescriptionsItem>
        </Descriptions>
      ) : null}
    </WorkbenchSection>
  );
}
