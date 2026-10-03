import type { AnnotationBatchResult } from "../../domain/annotation-runs/schema";
import {
  Alert,
  Button,
  Description,
  Dropdown,
  Label,
  ListBox,
  Modal,
  ProgressBar,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { Check } from "../../domain/annotation/checks";
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
  calibrating,
  disabled,
}: {
  review: Review;
  model: Model;
  /** The boxes an agent would refit, or null when the page shows none. */
  current: AnnotationInstance[] | null;
  /** While calibrating, only refitting the draft is offered. */
  calibrating: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const options: Start[] = calibrating ? ["refit"] : ["fresh", "refit"];
  if (calibrating && !current?.length) return null;
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
          {options.map((from) => (
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

const CHECK_LABELS: Record<Check["kind"], () => string> = {
  uncertain: m.ai_check_uncertain,
  issue: m.ai_check_issue,
};

/**
 * The agent's reading of this image: the one at work, the last that failed,
 * or the proposal it left with the places it asks a person to look at. A
 * model without instructions says why no agent can be asked.
 */
export function AiSection({
  review,
  model,
  canAnnotate,
  disabled,
  checks,
  onCheck,
}: {
  review: Review;
  model: Model;
  canAnnotate: boolean;
  disabled: boolean;
  /** The proposal's open checks against the boxes in view. */
  checks: Check[];
  onCheck: (check: Check) => void;
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
            {activity.status === "queued" ? m.ai_queued() : m.ai_running()}
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
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{m.ai_failed()}</Alert.Title>
          </Alert.Content>
        </Alert>
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
  onConfirm: () => Promise<AnnotationBatchResult>;
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
                      if (result.value.failed.length) {
                        toast.warning(
                          m.ai_batch_partial({
                            started: result.value.started,
                            skipped: result.value.skipped,
                            failed: result.value.failed.length,
                          }),
                        );
                      } else {
                        toast.success(
                          m.ai_batch_started({ count: result.value.started }),
                        );
                      }
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
