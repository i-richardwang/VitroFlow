import {
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";

import { m } from "../../paraglide/messages";
import type { TrainingRun } from "../../domain/training/schema";
import { Status, type StatusProps, type StatusTone } from "../../ui/kit/Status";

const PHASE_LABELS = {
  preparing: m.run_state_preparing,
  training: m.run_state_training,
  validating: m.run_state_validating,
} as const;

const STATUS_LABELS = {
  queued: m.run_state_queued,
  succeeded: m.run_state_succeeded,
  failed: m.run_state_failed,
} as const;

const LOOKS: Record<
  TrainingRun["state"]["status"],
  { tone: StatusTone; icon: LucideIcon }
> = {
  queued: { tone: "neutral", icon: Clock },
  running: { tone: "info", icon: LoaderCircle },
  succeeded: { tone: "success", icon: CircleCheck },
  failed: { tone: "error", icon: CircleX },
};

/**
 * A run's status; a running run names its phase and its glyph turns. Other
 * props reach the status, so it can be a tooltip trigger.
 */
export function TrainingRunState({
  run,
  ...props
}: { run: TrainingRun } & Omit<
  StatusProps,
  "children" | "tone" | "icon" | "spin"
>) {
  const { state } = run;
  const look = LOOKS[state.status];
  return (
    <Status
      {...props}
      tone={look.tone}
      icon={look.icon}
      spin={state.status === "running"}
    >
      {state.status === "running"
        ? PHASE_LABELS[state.phase]()
        : STATUS_LABELS[state.status]()}
    </Status>
  );
}
