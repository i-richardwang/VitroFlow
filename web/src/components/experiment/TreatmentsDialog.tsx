import {
  Button,
  Description,
  Fieldset,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  Tooltip,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  treatmentDescriptionSchema,
  treatmentNameSchema,
  type Treatment,
} from "../../experiments/schema";
import {
  createTreatment,
  editTreatment,
  removeTreatment,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { CloseIcon } from "../icons";
import { TreatmentDot } from "./TreatmentDot";

export function TreatmentsDialog({
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
  const [deleting, setDeleting] = useState<Treatment | null>(null);
  const { busy, run } = useAsyncAction();

  const close = () => {
    setDeleting(null);
    onClose();
  };

  const mutate = async <T,>(work: () => Promise<T>, failure: string) => {
    const result = await run(work, failure);
    if (result.ok) await router.invalidate();
    return result;
  };

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={(next) => !next && close()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Treatments</Modal.Heading>
                <Description>
                  The conditions dishes replicate. Assign each dish from the
                  color on its row.
                </Description>
              </Modal.Header>
              <Modal.Body
                key={isOpen ? "open" : "closed"}
                className="flex flex-col gap-6"
              >
                {treatments.length > 0 ? (
                  <Fieldset className="w-full">
                    <Fieldset.Group>
                      {treatments.map((treatment) => (
                        <TreatmentEditor
                          key={`${treatment.id}:${treatment.name}:${treatment.description}`}
                          treatment={treatment}
                          busy={busy}
                          onSave={async (name, description) => {
                            const result = await mutate(
                              () =>
                                editTreatment({
                                  data: {
                                    experiment,
                                    treatment: treatment.id,
                                    name,
                                    description,
                                  },
                                }),
                              "Treatment not saved",
                            );
                            return result.ok ? result.value : null;
                          }}
                          onRemove={() => setDeleting(treatment)}
                        />
                      ))}
                    </Fieldset.Group>
                  </Fieldset>
                ) : null}
                <Form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const input = event.currentTarget;
                    const form = new FormData(input);
                    void mutate(
                      () =>
                        createTreatment({
                          data: {
                            experiment,
                            name: String(form.get("name") ?? ""),
                            description: String(form.get("description") ?? ""),
                          },
                        }),
                      "Treatment not added",
                    ).then((result) => {
                      if (result.ok) input.reset();
                    });
                  }}
                >
                  <Fieldset className="w-full">
                    <Fieldset.Group>
                      <div className="flex items-end gap-3">
                        <TextField
                          variant="secondary"
                          className="w-36 shrink-0"
                          isRequired
                          isDisabled={busy}
                          name="name"
                        >
                          <Label>Name</Label>
                          <Input placeholder="T1" />
                        </TextField>
                        <TextField
                          variant="secondary"
                          className="min-w-0 flex-1"
                          isDisabled={busy}
                          name="description"
                        >
                          <Label>Description</Label>
                          <Input placeholder="6-BA 1.0 + NAA 0.1 mg/L" />
                        </TextField>
                        <Button
                          type="submit"
                          variant="secondary"
                          isDisabled={busy}
                        >
                          Add
                        </Button>
                      </div>
                    </Fieldset.Group>
                  </Fieldset>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <DeleteDialog
        isOpen={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
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

function TreatmentEditor({
  treatment,
  busy,
  onSave,
  onRemove,
}: {
  treatment: Treatment;
  busy: boolean;
  onSave: (name: string, description: string) => Promise<Treatment | null>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(treatment.name);
  const [description, setDescription] = useState(treatment.description);
  const normalized = { name: name.trim(), description: description.trim() };
  const dirty =
    normalized.name !== treatment.name ||
    normalized.description !== treatment.description;
  const valid =
    treatmentNameSchema.safeParse(normalized.name).success &&
    treatmentDescriptionSchema.safeParse(normalized.description).success;

  return (
    <Form
      className="flex items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || !valid) return;
        void onSave(normalized.name, normalized.description).then((saved) => {
          if (!saved) return;
          setName(saved.name);
          setDescription(saved.description);
        });
      }}
    >
      <TreatmentDot position={treatment.position} />
      <TextField
        aria-label={`${treatment.name} name`}
        variant="secondary"
        className="w-36 shrink-0"
        isDisabled={busy}
        value={name}
        onChange={setName}
      >
        <Input />
      </TextField>
      <TextField
        aria-label={`${treatment.name} description`}
        variant="secondary"
        className="min-w-0 flex-1"
        isDisabled={busy}
        value={description}
        onChange={setDescription}
      >
        <Input placeholder="6-BA 1.0 + NAA 0.1 mg/L" />
      </TextField>
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        isDisabled={busy || !dirty || !valid}
      >
        Save
      </Button>
      <Tooltip delay={0}>
        <Button
          type="button"
          variant="ghost"
          isIconOnly
          aria-label={`Remove ${treatment.name}`}
          isDisabled={busy}
          onPress={onRemove}
        >
          <CloseIcon />
        </Button>
        <Tooltip.Content>Remove</Tooltip.Content>
      </Tooltip>
    </Form>
  );
}
