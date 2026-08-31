import type { DateValue } from "@internationalized/date";
import { parseAbsoluteToLocal } from "@internationalized/date";
import {
  Button,
  Dropdown,
  FieldError,
  Fieldset,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ExperimentRound } from "../../experiments/schema";
import { editRound, removeRound } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { CapturedAtField, toInstant } from "./CapturedAtField";

type Action = "edit" | "delete";

export function RoundMenu({
  experiment,
  round,
}: {
  experiment: string;
  round: ExperimentRound;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <>
      <Dropdown>
        <Button variant="ghost" size="sm" className="-mr-2 font-medium">
          {round.label}
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={`Round ${round.label}`}
            onAction={(key) => {
              if (key === "edit" || key === "delete") setOpen(key);
            }}
          >
            <Dropdown.Item id="edit" textValue="Edit round">
              <Label>Edit round…</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="delete"
              textValue="Delete round"
              variant="danger"
            >
              <Label>Delete round…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "edit" ? (
        <EditRoundModal
          experiment={experiment}
          round={round}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(isOpen) => setOpen(isOpen ? "delete" : null)}
        title={`Delete ${round.label}?`}
        confirmLabel="Delete round"
        onConfirm={async () => {
          await removeRound({ data: { experiment, round: round.id } });
          toast.success(`${round.label} deleted`);
          await router.invalidate();
        }}
      >
        The column is removed from the experiment. Its photographs stay stored,
        with their detections and reviews, and can be uploaded again in a new
        round.
      </DeleteDialog>
    </>
  );
}

function EditRoundModal({
  experiment,
  round,
  onClose,
}: {
  experiment: string;
  round: ExperimentRound;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [capturedAt, setCapturedAt] = useState<DateValue | null>(() =>
    parseAbsoluteToLocal(round.capturedAt),
  );

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit round</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (capturedAt == null) return;
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      editRound({
                        data: {
                          experiment,
                          round: round.id,
                          label: String(form.get("label") ?? ""),
                          capturedAt: toInstant(capturedAt).toISOString(),
                        },
                      }),
                    "Round not saved",
                  ).then(async (result) => {
                    if (result.ok) {
                      onClose();
                      await router.invalidate();
                    }
                  });
                }}
              >
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <TextField
                      variant="secondary"
                      fullWidth
                      isRequired
                      isDisabled={busy}
                      name="label"
                      defaultValue={round.label}
                    >
                      <Label>Round label</Label>
                      <Input />
                      <FieldError />
                    </TextField>
                    <CapturedAtField
                      busy={busy}
                      value={capturedAt}
                      onChange={setCapturedAt}
                    />
                  </Fieldset.Group>
                  <Fieldset.Actions>
                    <Button variant="tertiary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </Fieldset.Actions>
                </Fieldset>
              </Form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
