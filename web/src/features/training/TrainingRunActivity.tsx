import type { TrainingRunDetail } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { Alert } from "../../ui/kit/Alert";
import { Text } from "../../ui/kit/Text";
import { Timestamp } from "../../ui/Timestamp";

const STALLED_AFTER_MS = 15 * 60_000;

export function TrainingRunActivity({
  detail: { run, attempts },
}: {
  detail: TrainingRunDetail;
}) {
  const status = run.state.status;
  const resumable = status === "paused" || status === "failed";
  const live = status === "running" || status === "queued";
  const stalled =
    status === "running" &&
    run.lastProgressAt !== null &&
    Date.now() - Date.parse(run.lastProgressAt) > STALLED_AFTER_MS;
  const expired =
    run.state.status === "running" &&
    Date.parse(run.state.leaseExpiresAt) <= Date.now();

  return (
    <div className="flex flex-col gap-4">
      {run.state.status === "running" ? (
        <Text>{m.training_running_worker({ worker: run.state.workerId })}</Text>
      ) : null}
      {status === "queued" ? (
        <Text>
          {run.targetWorkerId
            ? m.training_waiting_worker({ worker: run.targetWorkerId })
            : m.training_waiting_auto()}
        </Text>
      ) : null}
      {run.lastProgressAt ? (
        <Text type="secondary">
          {m.training_last_progress()} <Timestamp value={run.lastProgressAt} />
        </Text>
      ) : null}
      {expired || stalled ? (
        <Alert
          type="warning"
          title={expired ? m.training_lease_expired() : m.training_stalled()}
        />
      ) : null}
      {live || resumable ? (
        <Text type="secondary">
          {run.checkpoint
            ? m.training_checkpoint_available({ epoch: run.checkpoint.epoch })
            : m.training_checkpoint_none()}
        </Text>
      ) : null}
      {attempts.length ? (
        <div className="flex flex-col gap-2">
          <Text>{m.training_attempts()}</Text>
          {attempts.map((attempt) => (
            <Text key={attempt.attempt} size="sm" type="secondary">
              {m.training_attempt_entry({
                attempt: attempt.attempt,
                worker: attempt.workerId,
              })}{" "}
              · <Timestamp value={attempt.startedAt} /> ·{" "}
              {attempt.outcome === null
                ? m.run_state_training()
                : {
                    succeeded: m.run_state_succeeded,
                    failed: m.run_state_failed,
                    paused: m.run_state_paused,
                    cancelled: m.run_state_cancelled,
                    expired: m.training_attempt_expired,
                  }[attempt.outcome]()}
              {attempt.error ? ` · ${attempt.error}` : null}
            </Text>
          ))}
        </div>
      ) : null}
    </div>
  );
}
