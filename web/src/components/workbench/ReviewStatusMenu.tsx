import {
  Button,
  Dropdown,
  Form,
  Input,
  Label,
  Modal,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useState } from "react";

import type { AnnotationDocument, ReviewStatus } from "../../annotation/schema";
import {
  ReviewTransitionError,
  type ReviewEvent,
} from "../../annotation/status";
import { Hint } from "../Hint";
import { MoreIcon } from "../icons";

type ReviewAction = "complete" | "reopen" | "include";

const ACTIONS: Record<
  ReviewStatus,
  { items: { id: ReviewAction; label: string }[]; exclude?: string }
> = {
  in_progress: {
    items: [{ id: "complete", label: "Mark complete" }],
    exclude: "Exclude image…",
  },
  complete: {
    items: [{ id: "reopen", label: "Reopen" }],
    exclude: "Exclude image…",
  },
  excluded: {
    items: [{ id: "include", label: "Include image" }],
  },
};

export function ReviewStatusMenu({
  annotation,
  onReview,
}: {
  annotation: AnnotationDocument;
  onReview: (event: ReviewEvent) => void;
}) {
  const [excluding, setExcluding] = useState(false);
  const { items, exclude } = ACTIONS[annotation.status];

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
        <Hint text="Review actions">
          <Button
            variant="ghost"
            isIconOnly
            size="sm"
            aria-label="Review actions"
          >
            <MoreIcon />
          </Button>
        </Hint>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Review actions"
            onAction={(key) => {
              if (key === "exclude") {
                setExcluding(true);
                return;
              }
              if (key === "complete" || key === "reopen" || key === "include") {
                review({ type: key });
              }
            }}
          >
            {items.map((action) => (
              <Dropdown.Item
                key={action.id}
                id={action.id}
                textValue={action.label}
              >
                <Label>{action.label}</Label>
              </Dropdown.Item>
            ))}
            {exclude ? (
              <>
                <Separator orientation="horizontal" />
                <Dropdown.Item
                  id="exclude"
                  textValue="Exclude image"
                  variant="danger"
                >
                  <Label>{exclude}</Label>
                </Dropdown.Item>
              </>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ExcludeModal
        isOpen={excluding}
        onClose={() => setExcluding(false)}
        onSubmit={(reason) => review({ type: "exclude", reason })}
      />
    </>
  );
}

function ExcludeModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string | undefined) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Exclude image</Modal.Heading>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="exclude-image"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const reason = String(form.get("reason") ?? "").trim();
                  onSubmit(reason || undefined);
                  onClose();
                }}
              >
                <TextField variant="secondary" fullWidth name="reason">
                  <Label>Reason</Label>
                  <Input className="w-full" autoFocus />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose}>
                Cancel
              </Button>
              <Button type="submit" form="exclude-image" variant="danger">
                Exclude
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
