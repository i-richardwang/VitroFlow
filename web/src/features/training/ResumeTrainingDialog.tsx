import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { identifierLabel } from "../../domain/identifiers/schema";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  useAsyncAction,
  type AsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { Text } from "../../ui/kit/Text";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { controlRun } from "./run-control";
import { TrainingWorkerSelect } from "./TrainingWorkerSelect";

const FORM_ID = "resume-training";

/**
 * Continues a paused run or retries a failed one, on the worker it names;
 * a run with saved progress picks it up there unless told to start over.
 */
export function ResumeTrainingDialog({
  detail,
  open,
  onClose,
}: {
  detail: TrainingRunDetail;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  const retry = detail.run.state.status === "failed";
  const run = identifierLabel(detail.run.id);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        retry
          ? m.training_retry_title({ run })
          : m.training_resume_title({ run })
      }
      okText={retry ? m.training_retry() : m.training_resume()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ResumeTrainingForm detail={detail} action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ResumeTrainingForm({
  detail,
  action,
  onDone,
}: {
  detail: TrainingRunDetail;
  action: AsyncAction;
  onDone: () => void;
}) {
  const { run, workers } = detail;
  const router = useRouter();
  const [targetWorkerId, setTargetWorkerId] = useState(run.targetWorkerId);
  const [from, setFrom] = useState<"saved" | "start">("saved");

  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run(
            () =>
              controlRun(detail, {
                action: "resume",
                targetWorkerId,
                restart: from === "start",
              }),
            m.training_resume_failed(),
          )
          .then(async (result) => {
            if (!result.ok) return;
            onDone();
            await router.invalidate();
          });
      }}
    >
      <Form.Field label={m.training_worker()}>
        <TrainingWorkerSelect
          workers={workers}
          value={targetWorkerId}
          onChange={setTargetWorkerId}
          disabled={action.busy}
        />
      </Form.Field>
      {run.checkpoint ? (
        <Form.Field label={m.training_resume_from()} fieldset>
          <ToggleGroup
            aria-label={m.training_resume_from()}
            value={from}
            onChange={setFrom}
            options={[
              {
                value: "saved",
                label: m.training_resume_from_saved({
                  epoch: run.checkpoint.epoch,
                }),
                disabled: action.busy,
              },
              {
                value: "start",
                label: m.training_resume_from_start(),
                disabled: action.busy,
              },
            ]}
          />
        </Form.Field>
      ) : (
        <Text size="sm" type="secondary">
          {m.training_resume_no_progress()}
        </Text>
      )}
    </Form>
  );
}
