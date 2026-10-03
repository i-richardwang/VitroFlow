import { Description, Label, ListBox, ProgressBar } from "@heroui/react";

import type { Check } from "../../domain/annotation/checks";
import type { Review } from "../../domain/annotation/review";
import { m } from "../../paraglide/messages";
import { Timestamp } from "../../ui/Timestamp";
import { Section } from "./inspector";

const CHECK_LABELS: Record<Check["kind"], () => string> = {
  uncertain: m.ai_check_uncertain,
  issue: m.ai_check_issue,
};

/**
 * The agent's reading of this image: the one at work, or the proposal it
 * left with the places it asks a person to look at.
 */
export function AiSection({
  review,
  checks,
  onCheck,
}: {
  review: Review;
  /** The proposal's open checks against the boxes in view. */
  checks: Check[];
  onCheck: (check: Check) => void;
}) {
  const { activity, proposal } = review;
  if (!activity && !proposal) return null;
  return (
    <Section title={m.ai_section()}>
      {activity ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">{m.ai_running()}</span>
          <ProgressBar
            className="w-full"
            value={activity.completed}
            maxValue={activity.total}
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
      {checks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs text-muted">
            {m.ai_checks()} · {checks.length}
          </h3>
          <ListBox
            aria-label={m.ai_checks()}
            onAction={(key) => onCheck(checks[Number(key)]!)}
          >
            {checks.map((check, index) => (
              <ListBox.Item
                key={index}
                id={index}
                textValue={CHECK_LABELS[check.kind]()}
              >
                <Label>{CHECK_LABELS[check.kind]()}</Label>
                {check.kind === "issue" ? (
                  <Description>{check.reason}</Description>
                ) : null}
              </ListBox.Item>
            ))}
          </ListBox>
        </div>
      ) : null}
    </Section>
  );
}
