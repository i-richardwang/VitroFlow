import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  NumberField,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  treatmentNameSchema,
  type Treatment,
  type TreatmentFactor,
} from "../../experiments/schema";
import {
  createReplicates,
  createTreatment,
  editTreatment,
  removeTreatment,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { FactorField, factorDraft, submittedFactor } from "./FactorField";

export function TreatmentDialog({
  experiment,
  treatment,
  isOpen,
  onClose,
}: {
  experiment: string;
  treatment: Treatment | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={treatment?.id ?? "new"}
      experiment={experiment}
      treatment={treatment}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({
  experiment,
  treatment,
  isOpen,
  onClose,
}: {
  experiment: string;
  treatment: Treatment | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [name, setName] = useState(treatment?.name ?? "");
  const [factor, setFactor] = useState<TreatmentFactor>(
    factorDraft(treatment?.factor ?? null),
  );
  const [note, setNote] = useState(treatment?.note ?? "");
  const [replicates, setReplicates] = useState(3);
  const [removing, setRemoving] = useState(false);
  const creating = treatment === null;

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger aria-label={m.close()} />
              <Modal.Header>
                <Modal.Heading>
                  {creating
                    ? m.treatment_new()
                    : m.treatment_edit({ name: treatment.name })}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <Form
                  id="treatment"
                  className="flex w-full min-w-0 flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!treatmentNameSchema.safeParse(name).success) return;
                    const draft = {
                      name: name.trim(),
                      factor: submittedFactor(factor),
                      note,
                    };
                    void run(
                      () =>
                        creating
                          ? createTreatment({
                              data: { experiment, ...draft, replicates },
                            })
                          : editTreatment({
                              data: {
                                experiment,
                                treatment: treatment.id,
                                ...draft,
                              },
                            }),
                      creating
                        ? m.treatment_not_added()
                        : m.treatment_not_saved(),
                    ).then(async (result) => {
                      if (!result.ok) return;
                      if (creating) {
                        toast.success(m.treatment_added({ name: draft.name }));
                      }
                      onClose();
                      await router.invalidate();
                    });
                  }}
                >
                  <TextField
                    fullWidth
                    variant="secondary"
                    isRequired
                    isDisabled={busy}
                    value={name}
                    onChange={setName}
                  >
                    <Label>{m.treatment_name_label()}</Label>
                    <Input
                      className="w-full"
                      placeholder={m.treatment_name_placeholder()}
                    />
                  </TextField>
                  <FactorField
                    busy={busy}
                    factor={factor}
                    onChange={setFactor}
                  />
                  <TextField
                    fullWidth
                    variant="secondary"
                    isDisabled={busy}
                    value={note}
                    onChange={setNote}
                  >
                    <Label>{m.treatment_note_label()}</Label>
                    <Input className="w-full" />
                  </TextField>
                  {creating ? (
                    <NumberField
                      variant="secondary"
                      minValue={1}
                      maxValue={200}
                      isDisabled={busy}
                      value={replicates}
                      onChange={setReplicates}
                    >
                      <Label>{m.treatment_replicates_label()}</Label>
                      <NumberField.Group>
                        <NumberField.DecrementButton />
                        <NumberField.Input />
                        <NumberField.IncrementButton />
                      </NumberField.Group>
                    </NumberField>
                  ) : null}
                </Form>
                {creating ? null : (
                  <Button
                    variant="danger-soft"
                    isDisabled={busy}
                    onPress={() => setRemoving(true)}
                  >
                    {m.treatment_menu_remove()}
                  </Button>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                  {m.cancel()}
                </Button>
                <Button
                  type="submit"
                  form="treatment"
                  variant="primary"
                  isDisabled={busy}
                >
                  {busy
                    ? creating
                      ? m.experiment_action_adding()
                      : m.experiment_action_saving()
                    : creating
                      ? m.experiment_action_add()
                      : m.experiment_action_save()}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {treatment ? (
        <DestructiveActionDialog
          isOpen={removing}
          onOpenChange={(next) => !next && setRemoving(false)}
          title={m.treatment_delete_title({ name: treatment.name })}
          confirmLabel={m.treatment_delete()}
          onConfirm={async () => {
            await removeTreatment({
              data: { experiment, treatment: treatment.id },
            });
            setRemoving(false);
            onClose();
            await router.invalidate();
          }}
        >
          {m.treatment_delete_note()}
        </DestructiveActionDialog>
      ) : null}
    </>
  );
}

/** Lays out more replicates of a treatment, continuing its code series. */
export function ReplicatesDialog({
  experiment,
  treatment,
  isOpen,
  onClose,
}: {
  experiment: string;
  treatment: Treatment;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [replicates, setReplicates] = useState(1);
  const close = () => {
    setReplicates(1);
    onClose();
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && close()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>
                {m.treatment_add_replicates({ name: treatment.name })}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="add-replicates"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      createReplicates({
                        data: {
                          experiment,
                          treatment: treatment.id,
                          replicates,
                        },
                      }),
                    m.treatment_replicates_not_added(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(
                      m.treatment_replicates_added({
                        count: result.value.length,
                        name: treatment.name,
                      }),
                    );
                    close();
                    await router.invalidate();
                  });
                }}
              >
                <NumberField
                  variant="secondary"
                  minValue={1}
                  maxValue={200}
                  isDisabled={busy}
                  value={replicates}
                  onChange={setReplicates}
                >
                  <Label>{m.treatment_replicates_label()}</Label>
                  <NumberField.Group>
                    <NumberField.DecrementButton />
                    <NumberField.Input />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                </NumberField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={close}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="add-replicates"
                variant="primary"
                isDisabled={busy}
              >
                {busy
                  ? m.experiment_action_adding()
                  : m.experiment_action_add()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
