import { Chip, ProgressBar } from "@heroui/react";

import { versionSlug } from "../../models/schema";
import type { TrainingRun } from "../../training/schema";

type Tone = "default" | "accent" | "warning" | "success" | "danger";

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
    case "publishing":
      return "warning";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
  }
}

/** One training run's lifecycle state, with progress while it runs. */
export function TrainingRunState({ run }: { run: TrainingRun }) {
  const { state } = run;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Chip color={tone(state.status)} variant="soft" size="sm">
          {state.status === "running"
            ? PHASE_LABELS[state.phase]
            : state.status.charAt(0).toUpperCase() + state.status.slice(1)}
        </Chip>
        {state.status === "running" && (
          <span className="font-mono text-xs tabular-nums text-muted">
            {Math.round(state.progress * 100)}%
          </span>
        )}
        {state.status === "succeeded" && (
          <span className="font-mono text-xs text-muted">
            {versionSlug({ id: state.modelVersionId, modelId: run.modelId })}
          </span>
        )}
      </span>
      {state.status === "running" && (
        <ProgressBar
          aria-label="Training progress"
          value={state.progress}
          minValue={0}
          maxValue={1}
          size="sm"
          className="w-40"
        >
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      )}
      {state.status === "failed" && (
        <span
          className="max-w-72 truncate text-xs text-danger"
          title={state.error}
        >
          {state.error}
        </span>
      )}
    </span>
  );
}
