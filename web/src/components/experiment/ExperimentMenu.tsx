import {
  Button,
  Dropdown,
  Fieldset,
  Form,
  Label,
  Modal,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Experiment } from "../../experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";
import { ExperimentFields } from "./ExperimentFields";

type Action = "edit" | "delete";

export function ExperimentMenu({ experiment }: { experiment: Experiment }) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly aria-label="Experiment actions">
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Experiment actions"
            onAction={(key) => {
              if (key === "edit" || key === "delete") setOpen(key);
            }}
          >
            <Dropdown.Item id="edit" textValue="Edit details">
              <Label>Edit details…</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="delete"
              textValue="Delete experiment"
              variant="danger"
            >
              <Label>Delete experiment…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "edit" ? (
        <EditExperimentModal
          experiment={experiment}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(isOpen) => setOpen(isOpen ? "delete" : null)}
        title={`Delete ${experiment.name}?`}
        confirmLabel="Delete experiment"
        onConfirm={async () => {
          await removeExperiment({ data: { experiment: experiment.id } });
          toast.success(`${experiment.name} deleted`);
          await router.navigate({ to: "/experiments" });
        }}
      >
        Its treatments, dishes, and rounds are removed. The photographs stay
        stored, with their detections and reviews, for the datasets that use
        them.
      </DeleteDialog>
    </>
  );
}

function EditExperimentModal({
  experiment,
  onClose,
}: {
  experiment: Experiment;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit experiment</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      editExperiment({
                        data: {
                          experiment: experiment.id,
                          name: String(form.get("name") ?? ""),
                          description: String(form.get("description") ?? ""),
                        },
                      }),
                    "Experiment not saved",
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
                    <ExperimentFields busy={busy} defaults={experiment} />
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
