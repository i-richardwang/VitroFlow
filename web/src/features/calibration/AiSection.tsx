import { ProgressBar } from "@heroui/react";

import type { Review } from "../../domain/annotation/review";
import { m } from "../../paraglide/messages";
import { Timestamp } from "../../ui/Timestamp";
import { Metrics, Section } from "./inspector";

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
    <Section title={m.ai_section()}>
      {progress ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">{m.ai_running()}</span>
          <ProgressBar
            className="w-full"
            value={progress.completed}
            maxValue={progress.total}
            aria-label={m.ai_progress()}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </div>
      ) : null}
      {proposal ? (
        <p className="text-sm">
          <Timestamp value={proposal.createdAt} />
        </p>
      ) : null}
      {openChecks > 0 ? (
        <Metrics rows={[{ label: m.ai_checks(), value: openChecks }]} />
      ) : null}
    </Section>
  );
}
