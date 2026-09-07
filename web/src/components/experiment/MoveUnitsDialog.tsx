import {
  Button,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Unit } from "../../experiments/contracts";
import type { Treatment } from "../../experiments/schema";
import { editUnitsTreatment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { TreatmentDot } from "./TreatmentDot";

/** Moves the selected units to one treatment; each keeps its code. */
export function MoveUnitsDialog({
  experiment,
  units,
  treatments,
  isOpen,
  onClose,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={isOpen ? units.map((unit) => unit.id).join() : "closed"}
      experiment={experiment}
      units={units}
      treatments={treatments}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({
  experiment,
  units,
  treatments,
  isOpen,
  onClose,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const shared = units.every((unit) => unit.treatment === units[0]?.treatment)
    ? units[0]?.treatment
    : undefined;
  const [treatment, setTreatment] = useState(
    () =>
      treatments.find((item) => item.id !== shared)?.id ??
      treatments[0]?.id ??
      "",
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.experiment_move_units()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="move-units"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      editUnitsTreatment({
                        data: {
                          experiment,
                          units: units.map((unit) => unit.id),
                          treatment,
                        },
                      }),
                    m.experiment_units_not_moved(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    const name =
                      treatments.find((item) => item.id === treatment)?.name ??
                      "";
                    toast.success(
                      m.experiment_units_moved({
                        count: units.length,
                        treatment: name,
                      }),
                    );
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={treatment}
                  onSelectionChange={(key) => {
                    if (key !== null) setTreatment(String(key));
                  }}
                >
                  <Label>{m.treatment_label()}</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {treatments.map((item) => (
                        <ListBox.Item
                          key={item.id}
                          id={item.id}
                          textValue={item.name}
                        >
                          <TreatmentDot position={item.position} />
                          {item.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="move-units"
                variant="primary"
                isDisabled={busy || treatment === "" || units.length === 0}
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
