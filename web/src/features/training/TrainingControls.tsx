import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import type { TrainingControl } from "../../domain/training/schema";
import { controlTraining } from "../../functions/training";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Button } from "../../ui/kit/Button";
import { TrainingWorkerSelect } from "./TrainingWorkerSelect";

export function TrainingControls({
  detail: { dataset, run, workers },
}: {
  detail: TrainingRunDetail;
}) {
  const router = useRouter();
  const action = useAsyncAction();
  const [targetWorkerId, setTargetWorkerId] = useState(run.targetWorkerId);
  const status = run.state.status;
  const resumable = status === "paused" || status === "failed";
  const live = status === "running" || status === "queued";
  const control = (request: TrainingControl) => {
    void action
      .run(
        () =>
          controlTraining({
            data: {
              dataset: dataset.id,
              runId: run.id,
              attempt: run.attempt,
              control: request,
            },
          }),
        m.training_control_failed(),
      )
      .then(async (result) => {
        if (result.ok) await router.invalidate();
      });
  };

  return (
    <div className="flex flex-col gap-4">
      {resumable ? (
        <TrainingWorkerSelect
          workers={workers}
          value={targetWorkerId}
          onChange={setTargetWorkerId}
          disabled={action.busy}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {live ? (
          <Button
            disabled={action.busy}
            onClick={() => control({ action: "pause" })}
          >
            {m.training_pause()}
          </Button>
        ) : null}
        {resumable ? (
          <Button
            disabled={action.busy}
            onClick={() =>
              control({ action: "resume", targetWorkerId, restart: false })
            }
          >
            {status === "failed" ? m.training_retry() : m.training_resume()}
          </Button>
        ) : null}
        {resumable && run.checkpoint ? (
          <Button
            disabled={action.busy}
            onClick={() =>
              control({ action: "resume", targetWorkerId, restart: true })
            }
          >
            {m.training_restart()}
          </Button>
        ) : null}
        {live || resumable ? (
          <Button
            disabled={action.busy}
            onClick={() => control({ action: "cancel" })}
          >
            {m.training_cancel()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
