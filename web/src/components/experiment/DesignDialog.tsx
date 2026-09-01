import {
  Button,
  Chip,
  Description,
  Fieldset,
  Form,
  Input,
  Label,
  Modal,
  NumberField,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ObservationUnit } from "../../experiments/contracts";
import {
  formatFactors,
  treatmentNameSchema,
  type Treatment,
  type TreatmentFactor,
} from "../../experiments/schema";
import {
  createObservationUnits,
  createTreatment,
  createTreatmentReplicates,
  editTreatment,
  removeTreatment,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { FactorsField, filledFactors } from "./FactorsField";
import { TreatmentDot } from "./TreatmentDot";

export function DesignDialog({
  experiment,
  treatments,
  observationUnits,
  designLocked,
  isOpen,
  onClose,
}: {
  experiment: string;
  treatments: Treatment[];
  observationUnits: ObservationUnit[];
  designLocked: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Treatment | null>(null);
  const { busy, run } = useAsyncAction();

  const mutate = async <T,>(work: () => Promise<T>, failure: string) => {
    const result = await run(work, failure);
    if (result.ok) await router.invalidate();
    return result;
  };

  const replicatesOf = (treatment: string) =>
    observationUnits.filter(
      (observationUnit) => observationUnit.treatment === treatment,
    );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(next) => {
          if (next) return;
          setEditing(null);
          onClose();
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Design</Modal.Heading>
                <Description>
                  {designLocked
                    ? "Treatment definitions, assignments, and initial explant counts were fixed by the first observation."
                    : "Each observation unit is one independent replicate; explants within it are subsamples."}
                </Description>
              </Modal.Header>
              <Modal.Body
                key={isOpen ? "open" : "closed"}
                className="flex flex-col gap-6"
              >
                {treatments.map((treatment) =>
                  !designLocked && editing === treatment.id ? (
                    <TreatmentEditor
                      key={treatment.id}
                      treatment={treatment}
                      replicates={replicatesOf(treatment.id).length}
                      busy={busy}
                      onSave={async (value) => {
                        const result = await mutate(
                          () =>
                            editTreatment({
                              data: {
                                experiment,
                                treatment: treatment.id,
                                ...value,
                              },
                            }),
                          "Treatment not saved",
                        );
                        if (result.ok) setEditing(null);
                      }}
                      onAddReplicates={async (count, initialExplantCount) => {
                        await mutate(
                          () =>
                            createTreatmentReplicates({
                              data: {
                                experiment,
                                treatment: treatment.id,
                                replicates: count,
                                initialExplantCount,
                              },
                            }),
                          "Observation units not added",
                        );
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <TreatmentRow
                      key={treatment.id}
                      treatment={treatment}
                      replicates={replicatesOf(treatment.id).length}
                      busy={busy}
                      onEdit={
                        designLocked
                          ? undefined
                          : () => setEditing(treatment.id)
                      }
                      onRemove={
                        designLocked ? undefined : () => setDeleting(treatment)
                      }
                    />
                  ),
                )}
                {!designLocked ? (
                  <>
                    <Separator />
                    <NewTreatmentForm
                      busy={busy}
                      onSubmit={async (value) => {
                        const result = await mutate(
                          () =>
                            createTreatment({ data: { experiment, ...value } }),
                          "Treatment not added",
                        );
                        return result.ok;
                      }}
                    />
                    <UnassignedObservationUnits
                      busy={busy}
                      observationUnits={observationUnits.filter(
                        (observationUnit) => observationUnit.treatment === null,
                      )}
                      onSubmit={async (codes, initialExplantCount) => {
                        const result = await mutate(
                          () =>
                            createObservationUnits({
                              data: {
                                experiment,
                                treatment: null,
                                codes,
                                initialExplantCount,
                              },
                            }),
                          "Observation units not added",
                        );
                        return result.ok;
                      }}
                    />
                  </>
                ) : null}
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
        Its observation units stay in the experiment without a treatment. No
        images or reviews are removed.
      </DeleteDialog>
    </>
  );
}

function TreatmentRow({
  treatment,
  replicates,
  busy,
  onEdit,
  onRemove,
}: {
  treatment: Treatment;
  replicates: number;
  busy: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const condition = formatFactors(treatment.factors) || treatment.note;
  return (
    <div className="flex w-full items-center gap-3">
      <TreatmentDot position={treatment.position} />
      <span className="w-28 shrink-0 truncate font-medium">
        {treatment.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted">
        {condition || "No treatment factors specified"}
      </span>
      <Chip size="sm" variant="soft" className="tabular-nums">
        {replicates === 1
          ? "1 observation unit"
          : `${replicates} observation units`}
      </Chip>
      {onEdit ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={busy}
          onPress={onEdit}
        >
          Edit
        </Button>
      ) : null}
      {onRemove ? (
        <Button
          size="sm"
          variant="ghost"
          isDisabled={busy}
          onPress={onRemove}
          aria-label={`Remove ${treatment.name}`}
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}

interface TreatmentDraft {
  name: string;
  factors: TreatmentFactor[];
  note: string;
}

function TreatmentEditor({
  treatment,
  replicates,
  busy,
  onSave,
  onAddReplicates,
  onCancel,
}: {
  treatment: Treatment;
  replicates: number;
  busy: boolean;
  onSave: (value: TreatmentDraft) => Promise<void>;
  onAddReplicates: (
    count: number,
    initialExplantCount: number,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(treatment.name);
  const [factors, setFactors] = useState<TreatmentFactor[]>(treatment.factors);
  const [note, setNote] = useState(treatment.note);
  const [adding, setAdding] = useState(1);
  const [initialExplantCount, setInitialExplantCount] = useState(1);

  return (
    <Form
      className="w-full rounded-lg border border-default p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!treatmentNameSchema.safeParse(name).success) return;
        void onSave({
          name: name.trim(),
          factors: filledFactors(factors),
          note,
        });
      }}
    >
      <Fieldset className="w-full">
        <Fieldset.Group>
          <div className="flex w-full items-end gap-3">
            <TreatmentDot position={treatment.position} />
            <TextField
              variant="secondary"
              className="w-40 shrink-0"
              isRequired
              isDisabled={busy}
              value={name}
              onChange={setName}
            >
              <Label>Name</Label>
              <Input placeholder="T1" />
            </TextField>
            <TextField
              variant="secondary"
              className="min-w-0 flex-1"
              isDisabled={busy}
              value={note}
              onChange={setNote}
            >
              <Label>Note</Label>
              <Input placeholder="Anything the factors do not say" />
            </TextField>
          </div>
          <FactorsField busy={busy} factors={factors} onChange={setFactors} />
          <div className="flex w-full items-end gap-3">
            <NumberField
              className="w-32 shrink-0"
              variant="secondary"
              minValue={1}
              maxValue={50}
              isDisabled={busy}
              value={adding}
              onChange={setAdding}
            >
              <Label>Add replicates</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <Button
              type="button"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void onAddReplicates(adding, initialExplantCount)}
            >
              Add
            </Button>
            <NumberField
              className="w-36 shrink-0"
              variant="secondary"
              minValue={1}
              maxValue={10_000}
              isDisabled={busy}
              value={initialExplantCount}
              onChange={setInitialExplantCount}
            >
              <Label>Initial explants per unit</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <span className="pb-2 text-sm text-muted">
              {replicates === 1
                ? "1 observation unit so far"
                : `${replicates} observation units so far`}
            </span>
          </div>
        </Fieldset.Group>
        <Fieldset.Actions>
          <Button variant="tertiary" isDisabled={busy} onPress={onCancel}>
            Done
          </Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </Fieldset.Actions>
      </Fieldset>
    </Form>
  );
}

function NewTreatmentForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (
    value: TreatmentDraft & {
      replicates: number;
      initialExplantCount: number;
    },
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [replicates, setReplicates] = useState(3);
  const [initialExplantCount, setInitialExplantCount] = useState(1);
  const [factors, setFactors] = useState<TreatmentFactor[]>([]);

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        if (!treatmentNameSchema.safeParse(name).success) return;
        void onSubmit({
          name: name.trim(),
          factors: filledFactors(factors),
          note: "",
          replicates,
          initialExplantCount,
        }).then((ok) => {
          if (!ok) return;
          setName("");
          setFactors([]);
        });
      }}
    >
      <Fieldset className="w-full">
        <Fieldset.Group>
          <div className="flex w-full items-end gap-3">
            <TextField
              variant="secondary"
              className="w-40 shrink-0"
              isRequired
              isDisabled={busy}
              value={name}
              onChange={setName}
            >
              <Label>New treatment</Label>
              <Input placeholder="T1" />
            </TextField>
            <NumberField
              className="w-32 shrink-0"
              variant="secondary"
              minValue={0}
              maxValue={50}
              isDisabled={busy}
              value={replicates}
              onChange={setReplicates}
            >
              <Label>Replicates</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <Button type="submit" variant="primary" isDisabled={busy}>
              Add
            </Button>
            <NumberField
              className="w-36 shrink-0"
              variant="secondary"
              minValue={1}
              maxValue={10_000}
              isDisabled={busy}
              value={initialExplantCount}
              onChange={setInitialExplantCount}
            >
              <Label>Initial explants per unit</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <FactorsField busy={busy} factors={factors} onChange={setFactors} />
        </Fieldset.Group>
      </Fieldset>
    </Form>
  );
}

function UnassignedObservationUnits({
  busy,
  observationUnits,
  onSubmit,
}: {
  busy: boolean;
  observationUnits: ObservationUnit[];
  onSubmit: (codes: string[], initialExplantCount: number) => Promise<boolean>;
}) {
  const [codes, setCodes] = useState("");
  const [initialExplantCount, setInitialExplantCount] = useState(1);
  const parsedCodes = codes
    .split(/[\n,]/)
    .map((code) => code.trim())
    .filter(Boolean);

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        if (parsedCodes.length === 0) return;
        void onSubmit(parsedCodes, initialExplantCount).then((ok) => {
          if (!ok) return;
          setCodes("");
          toast.success(
            parsedCodes.length === 1
              ? "1 observation unit added"
              : `${parsedCodes.length} observation units added`,
          );
        });
      }}
    >
      <Fieldset className="w-full">
        <Fieldset.Group>
          <div className="flex w-full items-end gap-3">
            <TextField
              variant="secondary"
              className="min-w-0 flex-1"
              isDisabled={busy}
              value={codes}
              onChange={setCodes}
            >
              <Label>Observation units without a treatment</Label>
              <Input placeholder="CK-1, CK-2" />
            </TextField>
            <Button
              type="submit"
              variant="secondary"
              isDisabled={busy || parsedCodes.length === 0}
            >
              Add
            </Button>
            <NumberField
              className="w-36 shrink-0"
              variant="secondary"
              minValue={1}
              maxValue={10_000}
              isDisabled={busy}
              value={initialExplantCount}
              onChange={setInitialExplantCount}
            >
              <Label>Initial explants per unit</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          {observationUnits.length > 0 ? (
            <span className="text-sm text-muted">
              {observationUnits
                .map((observationUnit) => observationUnit.code)
                .join(", ")}
            </span>
          ) : null}
        </Fieldset.Group>
      </Fieldset>
    </Form>
  );
}
