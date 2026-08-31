import {
  Button,
  Description,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Separator,
  TextField,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Treatment } from "../../experiments/schema";
import {
  createTreatment,
  editTreatment,
  placeDish,
  removeTreatment,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type { ExperimentDish } from "../../experiments/contracts";
import { DeleteDialog } from "../DeleteDialog";
import { CloseIcon } from "../icons";

const UNASSIGNED = "unassigned";

export function TreatmentsDialog({
  experiment,
  treatments,
  dishes,
}: {
  experiment: string;
  treatments: Treatment[];
  dishes: ExperimentDish[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        Treatments
      </Button>
      {open ? (
        <TreatmentsModal
          experiment={experiment}
          treatments={treatments}
          dishes={dishes}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TreatmentsModal({
  experiment,
  treatments,
  dishes,
  onClose,
}: {
  experiment: string;
  treatments: Treatment[];
  dishes: ExperimentDish[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<Treatment | null>(null);
  const { busy, run } = useAsyncAction();

  const mutate = async (work: () => Promise<unknown>, failure: string) => {
    const result = await run(work, failure);
    if (result.ok) await router.invalidate();
    return result;
  };

  return (
    <>
      <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Treatments</Modal.Heading>
                <Description>
                  The conditions this experiment compares. Dishes under one
                  treatment are its replicates; the grid groups and averages
                  them.
                </Description>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-5">
                <ul className="flex flex-col gap-2">
                  {treatments.map((treatment) => (
                    <li key={treatment.id} className="flex items-center gap-2">
                      <TextField
                        aria-label={`Treatment ${treatment.position}`}
                        variant="secondary"
                        fullWidth
                        isDisabled={busy}
                        defaultValue={treatment.name}
                        onBlur={(event) => {
                          const name = event.currentTarget.value.trim();
                          if (!name || name === treatment.name) return;
                          void mutate(
                            () =>
                              editTreatment({
                                data: {
                                  experiment,
                                  treatment: treatment.id,
                                  name,
                                },
                              }),
                            "Treatment not renamed",
                          );
                        }}
                      >
                        <Input />
                      </TextField>
                      <Button
                        variant="ghost"
                        isIconOnly
                        aria-label={`Remove ${treatment.name}`}
                        isDisabled={busy}
                        onPress={() => setDeleting(treatment)}
                      >
                        <CloseIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const input = event.currentTarget;
                    const name = String(new FormData(input).get("name") ?? "");
                    void mutate(
                      () => createTreatment({ data: { experiment, name } }),
                      "Treatment not added",
                    ).then((result) => {
                      if (result.ok) input.reset();
                    });
                  }}
                >
                  <TextField
                    variant="secondary"
                    fullWidth
                    isRequired
                    isDisabled={busy}
                    name="name"
                  >
                    <Label>New treatment</Label>
                    <Input placeholder="MS + 6-BA 1.0 mg/L" />
                  </TextField>
                  <Button type="submit" variant="secondary" isDisabled={busy}>
                    Add
                  </Button>
                </Form>

                {dishes.length > 0 && treatments.length > 0 ? (
                  <>
                    <Separator />
                    <ul className="flex flex-col gap-2">
                      {dishes.map((dish) => (
                        <li
                          key={dish.label}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="font-mono font-medium">
                            {dish.label}
                          </span>
                          <Select
                            aria-label={`Treatment of dish ${dish.label}`}
                            variant="secondary"
                            className="w-56"
                            isDisabled={busy}
                            selectedKey={dish.treatment ?? UNASSIGNED}
                            onSelectionChange={(key) => {
                              const treatment =
                                key === null || key === UNASSIGNED
                                  ? null
                                  : String(key);
                              if (treatment === dish.treatment) return;
                              void mutate(
                                () =>
                                  placeDish({
                                    data: {
                                      experiment,
                                      dish: dish.label,
                                      treatment,
                                    },
                                  }),
                                "Dish not assigned",
                              );
                            }}
                          >
                            <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                <ListBox.Item
                                  id={UNASSIGNED}
                                  textValue="Unassigned"
                                >
                                  <Label className="text-muted">
                                    Unassigned
                                  </Label>
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                                {treatments.map((treatment) => (
                                  <ListBox.Item
                                    key={treatment.id}
                                    id={treatment.id}
                                    textValue={treatment.name}
                                  >
                                    <Label>{treatment.name}</Label>
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <DeleteDialog
        isOpen={deleting !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "treatment"}?`}
        confirmLabel="Delete treatment"
        onConfirm={async () => {
          if (!deleting) return;
          await removeTreatment({
            data: { experiment, treatment: deleting.id },
          });
          await router.invalidate();
        }}
      >
        Its dishes become unassigned. No photographs or reviews are removed.
      </DeleteDialog>
    </>
  );
}
