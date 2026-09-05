import { Chip } from "@heroui/react";

import { m } from "../../paraglide/messages";
import type { TrainingRun } from "../../training/schema";

type Tone = "default" | "accent" | "success" | "danger";

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

function tone(status: TrainingRun["state"]["status"]): Tone {
  switch (status) {
    case "queued":
      return "default";
    case "running":
      return "accent";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
  }
}

export function TrainingRunState({ run }: { run: TrainingRun }) {
  const { state } = run;
  return (
    <Chip color={tone(state.status)} variant="soft" size="sm">
      {state.status === "running"
        ? PHASE_LABELS[state.phase]()
        : STATUS_LABELS[state.status]()}
    </Chip>
  );
}
