import {
  Button,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Treatment } from "../../experiments/schema";
import { createObservationUnits } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { TreatmentDot } from "./TreatmentDot";

const UNASSIGNED = "unassigned";

export function AddObservationUnitsDialog({
  experiment,
  treatments,
  isOpen,
  onClose,
}: {
  experiment: string;
  treatments: Treatment[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [codes, setCodes] = useState("");
  const [treatment, setTreatment] = useState<string>(UNASSIGNED);
  const parsedCodes = codes
    .split(/[\n,]/)
    .map((code) => code.trim())
    .filter(Boolean);

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (next) return;
        setCodes("");
        setTreatment(UNASSIGNED);
        onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Add observation units</Modal.Heading>
            </Modal.Header>
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="add-observation-units"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (parsedCodes.length === 0) return;
                  void run(
                    () =>
                      createObservationUnits({
                        data: {
                          experiment,
                          treatment:
                            treatment === UNASSIGNED ? null : treatment,
                          codes: parsedCodes,
                        },
                      }),
                    "Observation units not added",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(
                      parsedCodes.length === 1
                        ? "1 observation unit added"
                        : `${parsedCodes.length} observation units added`,
                    );
                    setCodes("");
                    setTreatment(UNASSIGNED);
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
                  value={codes}
                  onChange={setCodes}
                >
                  <Label>Codes</Label>
                  <Input className="w-full" placeholder="CK-1, CK-2" />
                </TextField>
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={treatment}
                  onSelectionChange={(key) =>
                    setTreatment(key === null ? UNASSIGNED : String(key))
                  }
                >
                  <Label>Treatment</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id={UNASSIGNED} textValue="No treatment">
                        <TreatmentDot position={null} />
                        No treatment
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
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
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-observation-units"
                variant="primary"
                isDisabled={busy || parsedCodes.length === 0}
              >
                {busy ? "Adding…" : "Add"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
