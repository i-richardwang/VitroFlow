import {
  Button,
  Dropdown,
  Label,
  Modal,
  ProgressBar,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import { agentBusy, type Review } from "../../domain/annotation/review";
import type { AnnotationInstance } from "../../domain/annotation/schema";
import type { Model } from "../../domain/models/schema";
import {
  startAnnotationRun,
  stopAnnotationRun,
} from "../../functions/annotation-runs";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Timestamp } from "../../ui/Timestamp";
import { Section } from "./inspector";

type Start = "fresh" | "refit";

const START_LABELS: Record<Start, () => string> = {
  fresh: m.ai_fresh,
  refit: m.ai_refit,
};

/**
 * Asks an agent to read the image: from the image alone, or by refitting the
 * boxes the page shows. The result arrives with the page's next load.
 */
export function AiAnnotateMenu({
  review,
  model,
  current,
  disabled,
}: {
  review: Review;
  model: Model;
  /** The boxes an agent would refit, or null when the page shows none. */
  current: AnnotationInstance[] | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const blocked =
    disabled ||
    busy ||
    model.annotation.instructions.length === 0 ||
    agentBusy(review);
  const start = (from: Start) =>
    void run(
      () =>
        startAnnotationRun({
          data: {
            ref: review.ref,
            input: from === "refit" ? current : null,
            scope: null,
          },
        }),
      m.ai_not_started(),
    ).then(async (result) => {
      if (result.ok) await router.invalidate();
    });
  return (
    <Dropdown>
      <Button variant="secondary" isDisabled={blocked}>
        {m.ai_annotation()}
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={m.ai_annotation()}
          onAction={(key) => start(String(key) as Start)}
          disabledKeys={current?.length ? [] : ["refit"]}
        >
          {(["fresh", "refit"] as const).map((from) => (
            <Dropdown.Item
              key={from}
              id={from}
              textValue={START_LABELS[from]()}
            >
              <Label>{START_LABELS[from]()}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * The agent's reading of this image: the one at work, the last that failed,
 * or the proposal it left. A model without instructions says why no agent
 * can be asked.
 */
export function AiSection({
  review,
  model,
  canAnnotate,
  disabled,
}: {
  review: Review;
  model: Model;
  canAnnotate: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const { activity, proposal } = review;
  const uninstructed =
    canAnnotate && model.annotation.instructions.length === 0;
  if (!activity && !proposal && !uninstructed) return null;
  return (
    <Section title={m.ai_section()}>
      {activity && activity.status !== "failed" ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm">
            {activity.status === "queued" ? m.ai_queued() : m.ai_running()} ·{" "}
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
                () => stopAnnotationRun({ data: review.ref }),
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
          {m.ai_failed()}
        </p>
      ) : null}
      {proposal ? (
        <>
          <p className="text-sm">
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
      {uninstructed ? (
        <p className="text-sm text-muted">{m.ai_no_instructions()}</p>
      ) : null}
    </Section>
  );
}

/**
 * Asks an agent to draw every image nobody has calibrated. The count is the
 * cost the person agrees to.
 */
export function AnnotateImagesDialog({
  isOpen,
  count,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  count: number;
  onConfirm: () => Promise<number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.ai_batch_title()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm">{m.ai_batch_count({ count })}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                variant="primary"
                isDisabled={busy || count === 0}
                onPress={() =>
                  void run(onConfirm, m.ai_not_started()).then(
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
