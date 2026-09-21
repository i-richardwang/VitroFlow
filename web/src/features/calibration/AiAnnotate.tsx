import {
  Button,
  Dropdown,
  Label,
  ListBox,
  Modal,
  ProgressBar,
  Select,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { agentBusy, type Review } from "../../domain/annotation/review";
import type { AnnotationInstance } from "../../domain/annotation/schema";
import type { AnnotationRuntimeName } from "../../domain/annotation-runs/schema";
import type { Model } from "../../domain/models/schema";
import {
  startAnnotationRun,
  stopAnnotationRun,
} from "../../functions/annotation-runs";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Timestamp } from "../../ui/Timestamp";
import { Section } from "./inspector";
import { agentLabels } from "./labels";

type Start = "fresh" | "refit";

/**
 * Asks an agent to read the image: from the image alone, or by refitting the
 * boxes the page shows. The result arrives with the page's next load.
 */
export function AiAnnotateMenu({
  review,
  model,
  agents,
  current,
  disabled,
}: {
  review: Review;
  model: Model;
  agents: AnnotationRuntimeName[];
  /** The boxes an agent would refit, or null when the page shows none. */
  current: AnnotationInstance[] | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const blocked =
    disabled ||
    busy ||
    agents.length === 0 ||
    model.annotation.instructions.length === 0 ||
    agentBusy(review);
  const start = (agent: AnnotationRuntimeName, from: Start) =>
    void run(
      () =>
        startAnnotationRun({
          data: {
            id: crypto.randomUUID(),
            ref: review.ref,
            runtime: agent,
            input: from === "refit" ? current : null,
          },
        }),
      m.ai_not_started(),
    ).then(async (result) => {
      if (result.ok) await router.invalidate();
    });
  const label = (agent: AnnotationRuntimeName, from: Start) => {
    const text = from === "fresh" ? m.ai_fresh() : m.ai_refit();
    return agents.length > 1 ? `${agentLabels[agent]()} · ${text}` : text;
  };
  return (
    <Dropdown>
      <Button variant="secondary" isDisabled={blocked}>
        {m.ai_annotation()}
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={m.ai_annotation()}
          onAction={(key) => {
            const [agent, from] = String(key).split(":") as [
              AnnotationRuntimeName,
              Start,
            ];
            start(agent, from);
          }}
          disabledKeys={
            current?.length ? [] : agents.map((agent) => `${agent}:refit`)
          }
        >
          {agents.flatMap((agent) =>
            (["fresh", "refit"] as const).map((from) => (
              <Dropdown.Item
                key={`${agent}:${from}`}
                id={`${agent}:${from}`}
                textValue={label(agent, from)}
              >
                <Label>{label(agent, from)}</Label>
              </Dropdown.Item>
            )),
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/** What the agent is doing or did for this image, and why it cannot be asked. */
export function AiSection({
  review,
  model,
  agents,
  disabled,
}: {
  review: Review;
  model: Model;
  agents: AnnotationRuntimeName[];
  disabled: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const { activity, proposal } = review;
  const stateLabels = {
    queued: m.ai_queued,
    running: m.ai_running,
    failed: m.ai_failed,
  };
  const blocker =
    agents.length === 0
      ? m.ai_no_worker()
      : model.annotation.instructions.length === 0
        ? m.ai_no_instructions()
        : null;
  if (!activity && !proposal && !blocker) return null;
  return (
    <Section title={m.ai_section()}>
      {activity && activity.status !== "failed" ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">
            {agentLabels[activity.agent]()} · {stateLabels[activity.status]()} ·{" "}
            {activity.progress.completed}/{activity.progress.total}
          </span>
          <ProgressBar
            className="w-full"
            value={activity.progress.completed}
            maxValue={activity.progress.total}
            aria-label={m.ai_progress()}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <Button
            variant="tertiary"
            isDisabled={disabled || busy}
            onPress={() =>
              void run(
                () => stopAnnotationRun({ data: activity.runId }),
                m.ai_not_stopped(),
              ).then(async (result) => {
                if (result.ok) await router.invalidate();
              })
            }
          >
            {m.ai_stop()}
          </Button>
        </div>
      ) : null}
      {activity?.status === "failed" ? (
        <p role="alert" className="text-sm text-danger">
          {agentLabels[activity.agent]()} · {m.ai_failed()}
          {activity.error ? ` · ${activity.error}` : null}
        </p>
      ) : null}
      {proposal ? (
        <>
          <p className="text-sm">
            {agentLabels[proposal.agent]()} ·{" "}
            <Timestamp value={proposal.createdAt} />
          </p>
          <p className="text-xs text-muted">
            {m.ai_result_summary({
              count: proposal.document.instances.length,
              issues: proposal.issues.length,
              uncertain: proposal.uncertainIds.length,
            })}
          </p>
          {proposal.issues.length > 0 ? (
            <details className="text-xs">
              <summary>{m.ai_issues()}</summary>
              <ul className="space-y-1">
                {proposal.issues.map((issue, index) => (
                  <li key={index}>{issue.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      {blocker ? <p className="text-sm text-muted">{blocker}</p> : null}
    </Section>
  );
}

/**
 * Asks an agent to draw every image nobody has calibrated. The count is the
 * cost the person agrees to; the runs queue for any Worker that runs the
 * agent.
 */
export function AnnotateImagesDialog({
  isOpen,
  count,
  agents,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  count: number;
  agents: AnnotationRuntimeName[];
  onConfirm: (agent: AnnotationRuntimeName) => Promise<number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [agent, setAgent] = useState<AnnotationRuntimeName | null>(null);
  const chosen = agent && agents.includes(agent) ? agent : agents[0];
  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.ai_batch_title()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-sm">{m.ai_batch_count({ count })}</p>
              {agents.length > 1 ? (
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={chosen ?? null}
                  onSelectionChange={(key) =>
                    key !== null &&
                    setAgent(String(key) as AnnotationRuntimeName)
                  }
                >
                  <Label>{m.ai_agent()}</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {agents.map((name) => (
                        <ListBox.Item
                          key={name}
                          id={name}
                          textValue={agentLabels[name]()}
                        >
                          {agentLabels[name]()}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                variant="primary"
                isDisabled={busy || !chosen || count === 0}
                onPress={() =>
                  chosen &&
                  void run(() => onConfirm(chosen), m.ai_not_started()).then(
                    async (result) => {
                      if (!result.ok) return;
                      onClose();
                      toast.success(
                        m.ai_batch_started({ count: result.value }),
                      );
                      await router.invalidate();
                    },
                  )
                }
              >
                {m.ai_batch_confirm()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
