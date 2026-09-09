import {
  Button,
  Dropdown,
  Form,
  Label,
  Modal,
  Separator,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { DateValue } from "@internationalized/date";

import type { Experiment } from "../../experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { MoreIcon } from "../icons";
import { fromDay, toDay } from "./DayField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

type Action = "edit" | "delete";

export function ExperimentMenu({
  experiment,
  hasRecords,
  onNewTreatment,
}: {
  experiment: Experiment;
  hasRecords: boolean;
  onNewTreatment: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly aria-label={m.experiment_actions()}>
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={m.experiment_actions()}
            onAction={(key) => {
              const id = String(key);
              if (id === "treatment") {
                onNewTreatment();
                return;
              }
              setOpen(id as Action);
            }}
          >
            <Dropdown.Item id="treatment" textValue={m.treatment_new()}>
              <Label>{m.treatment_menu_new()}</Label>
            </Dropdown.Item>
            <Separator orientation="horizontal" />
            <Dropdown.Item id="edit" textValue={m.experiment_edit_details()}>
              <Label>{m.experiment_menu_edit()}</Label>
            </Dropdown.Item>
            {!hasRecords ? (
              <Dropdown.Item
                id="delete"
                textValue={m.experiment_delete()}
                variant="danger"
              >
                <Label>{m.experiment_menu_delete()}</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <EditExperimentDialog
        experiment={experiment}
        isOpen={open === "edit"}
        onClose={close}
      />

      <DestructiveActionDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={m.experiment_delete_title({ name: experiment.name })}
        confirmLabel={m.experiment_delete()}
        onConfirm={async () => {
          await removeExperiment({ data: { experiment: experiment.id } });
          toast.success(m.experiment_deleted({ name: experiment.name }));
          await router.navigate({ to: "/experiments" });
        }}
      />
    </>
  );
}

function EditExperimentDialog({
  experiment,
  isOpen,
  onClose,
}: {
  experiment: Experiment;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [inoculatedOn, setInoculatedOn] = useState<DateValue | null>(() =>
    fromDay(experiment.inoculatedOn),
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.experiment_edit_heading()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="edit-experiment"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (inoculatedOn === null) return;
                  const form = new FormData(event.currentTarget);
                  const fields = readExperimentFields(form);
                  void run(
                    () =>
                      editExperiment({
                        data: {
                          experiment: experiment.id,
                          ...fields,
                          inoculatedOn: toDay(inoculatedOn),
                        },
                      }),
                    m.experiment_not_saved(),
                  ).then(async (result) => {
                    if (result.ok) {
                      onClose();
                      await router.invalidate();
                    }
                  });
                }}
              >
                <ExperimentFields
                  busy={busy}
                  defaults={experiment}
                  inoculatedOn={inoculatedOn}
                  onInoculatedOnChange={setInoculatedOn}
                />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="edit-experiment"
                variant="primary"
                isDisabled={busy}
              >
                {busy
                  ? m.experiment_action_saving()
                  : m.experiment_action_save()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
