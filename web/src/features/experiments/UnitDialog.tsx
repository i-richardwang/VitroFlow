import {
  Button,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import type { Treatment } from "../../domain/experiments/schema";
import { editUnit } from "../../functions/experiments";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { TreatmentDot } from "./TreatmentDot";

/** Corrects a unit's code or the treatment it replicates; its records stay. */
export function UnitDialog({
  experiment,
  unit,
  treatments,
  isOpen,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={isOpen ? unit.id : "closed"}
      experiment={experiment}
      unit={unit}
      treatments={treatments}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({
  experiment,
  unit,
  treatments,
  isOpen,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [code, setCode] = useState(unit.code);
  const [treatment, setTreatment] = useState(unit.treatment);

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.unit_edit()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="edit-unit"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      editUnit({
                        data: { experiment, unit: unit.id, code, treatment },
                      }),
                    m.unit_not_saved(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <TextField
                  variant="secondary"
                  fullWidth
                  isRequired
                  isDisabled={busy}
                  value={code}
                  onChange={setCode}
                >
                  <Label>{m.unit_code_label()}</Label>
                  <Input className="w-full" />
                </TextField>
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
                form="edit-unit"
                variant="primary"
                isDisabled={busy || code.trim() === ""}
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
