import {
  Button,
  Dropdown,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useState } from "react";

import type { AnnotationDocument, ReviewStatus } from "../../annotation/schema";
import {
  ReviewTransitionError,
  type ReviewEvent,
} from "../../annotation/status";
import { ImageStateDot, imageStateLabel } from "../ImageState";

type Action = "complete" | "reopen" | "include" | "exclude";

const ACTIONS: Record<ReviewStatus, { id: Action; label: string }[]> = {
  in_progress: [
    { id: "complete", label: "Mark complete" },
    { id: "exclude", label: "Exclude image…" },
  ],
  complete: [
    { id: "reopen", label: "Reopen" },
    { id: "exclude", label: "Exclude image…" },
  ],
  excluded: [{ id: "include", label: "Include image" }],
};

export function ReviewStatusMenu({
  annotation,
  onReview,
}: {
  annotation: AnnotationDocument;
  onReview: (event: ReviewEvent) => void;
}) {
  const [excluding, setExcluding] = useState(false);

  const review = (event: ReviewEvent) => {
    try {
      onReview(event);
    } catch (cause) {
      toast.danger(
        cause instanceof ReviewTransitionError ? cause.message : String(cause),
      );
    }
  };

  return (
    <>
      <Dropdown>
        <Button variant="ghost">
          <ImageStateDot state={annotation.status} />
          {imageStateLabel(annotation.status)}
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Review status"
            onAction={(key) => {
              if (key === "exclude") {
                setExcluding(true);
              } else if (
                key === "complete" ||
                key === "reopen" ||
                key === "include"
              ) {
                review({ type: key });
              }
            }}
          >
            {ACTIONS[annotation.status].map((action) => (
              <Dropdown.Item key={action.id} id={action.id}>
                {action.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {excluding ? (
        <ExcludeModal
          onClose={() => setExcluding(false)}
          onSubmit={(reason) => review({ type: "exclude", reason })}
        />
      ) : null}
    </>
  );
}

function ExcludeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit(reason.trim() || undefined);
                onClose();
              }}
            >
              <Modal.Header>
                <Modal.Heading>Exclude image</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <TextField
                  variant="secondary"
                  value={reason}
                  onChange={setReason}
                  fullWidth
                >
                  <Label>Reason</Label>
                  <Input placeholder="Optional" autoFocus />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" slot="close">
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Exclude
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
