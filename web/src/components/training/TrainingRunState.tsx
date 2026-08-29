import { Chip } from "@heroui/react";

import type { TrainingRun } from "../../training/schema";

type Tone = "default" | "accent" | "success" | "danger";

const PHASE_LABELS = {
  preparing: "Preparing",
  training: "Training",
  validating: "Validating",
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

/** One training run's lifecycle state. */
export function TrainingRunState({ run }: { run: TrainingRun }) {
  const { state } = run;
  return (
    <Chip color={tone(state.status)} variant="soft" size="sm">
      {state.status === "running"
        ? PHASE_LABELS[state.phase]
        : state.status.charAt(0).toUpperCase() + state.status.slice(1)}
    </Chip>
  );
}
