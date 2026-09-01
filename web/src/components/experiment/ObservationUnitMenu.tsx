import {
  Button,
  Chip,
  Description,
  Dropdown,
  Fieldset,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  NumberField,
  Select,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ObservationUnit } from "../../experiments/contracts";
import { CULTURE_EVENT_LABELS } from "../../experiments/culture-events";
import {
  CULTURE_EVENT_TYPES,
  observationLabel,
  type CultureEvent,
  type CultureEventType,
  type ExperimentObservation,
  type Treatment,
} from "../../experiments/schema";
import {
  correctCultureEvent,
  createCultureEvent,
  editObservationUnit,
  assignObservationUnitsToTreatment,
  removeObservationUnit,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";
import { TreatmentDot } from "./TreatmentDot";

type Action = "edit" | "event" | "delete";

const UNASSIGNED = "unassigned";

export function ObservationUnitMenu({
  experiment,
  observationUnit,
  treatments,
  observations,
  designLocked,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  treatments: Treatment[];
  observations: ExperimentObservation[];
  designLocked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const { busy, run } = useAsyncAction();

  const assign = (treatment: string | null) => {
    if (treatment === observationUnit.treatment) return;
    void run(
      () =>
        assignObservationUnitsToTreatment({
          data: {
            experiment,
            observationUnits: [observationUnit.id],
            treatment,
          },
        }),
      "Observation unit not assigned",
    ).then(async (result) => {
      if (result.ok) await router.invalidate();
    });
  };

  return (
    <>
      <Dropdown>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          isDisabled={busy}
          aria-label={`Observation unit ${observationUnit.code}`}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom start">
          <Dropdown.Menu
            aria-label={`Observation unit ${observationUnit.code}`}
            onAction={(key) => {
              const id = String(key);
              if (id.startsWith("treatment:")) {
                const treatment = id.slice("treatment:".length);
                assign(treatment === UNASSIGNED ? null : treatment);
                return;
              }
              setOpen(id as Action);
            }}
          >
            <Dropdown.Item id="edit" textValue="Edit observation unit">
              <Label>Edit observation unit…</Label>
            </Dropdown.Item>
            {observations.length > 0 ? (
              <Dropdown.Item id="event" textValue="Record culture event">
                <Label>Culture events…</Label>
              </Dropdown.Item>
            ) : null}
            {!designLocked ? (
              <>
                <Separator />
                {treatments.map((treatment) => (
                  <Dropdown.Item
                    key={treatment.id}
                    id={`treatment:${treatment.id}`}
                    textValue={treatment.name}
                  >
                    <TreatmentDot position={treatment.position} />
                    <Label>{treatment.name}</Label>
                  </Dropdown.Item>
                ))}
                <Dropdown.Item
                  id={`treatment:${UNASSIGNED}`}
                  textValue="No treatment"
                >
                  <TreatmentDot position={null} />
                  <Label>No treatment</Label>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item
                  id="delete"
                  textValue="Delete observation unit"
                  variant="danger"
                >
                  <Label>Delete observation unit…</Label>
                </Dropdown.Item>
              </>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {open === "edit" ? (
        <EditObservationUnitModal
          experiment={experiment}
          observationUnit={observationUnit}
          designLocked={designLocked}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === "event" ? (
        <CultureEventsModal
          experiment={experiment}
          observationUnit={observationUnit}
          observations={observations}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DeleteDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={`Delete ${observationUnit.code}?`}
        confirmLabel="Delete observation unit"
        onConfirm={async () => {
          await removeObservationUnit({
            data: { experiment, observationUnit: observationUnit.id },
          });
          toast.success(`${observationUnit.code} deleted`);
          await router.invalidate();
        }}
      >
        This draft row is removed from the experimental design.
      </DeleteDialog>
    </>
  );
}

function EditObservationUnitModal({
  experiment,
  observationUnit,
  designLocked,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  designLocked: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [initialExplantCount, setInitialExplantCount] = useState(
    observationUnit.initialExplantCount,
  );

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Edit observation unit</Modal.Heading>
              <Description>
                Correcting the code does not change the observation unit or its
                records.
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      editObservationUnit({
                        data: {
                          experiment,
                          observationUnit: observationUnit.id,
                          code: String(form.get("code") ?? ""),
                          initialExplantCount: designLocked
                            ? observationUnit.initialExplantCount
                            : initialExplantCount,
                        },
                      }),
                    "Observation unit not saved",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.invalidate();
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
                      name="code"
                      defaultValue={observationUnit.code}
                    >
                      <Label>Code</Label>
                      <Input />
                    </TextField>
                    <NumberField
                      variant="secondary"
                      fullWidth
                      minValue={1}
                      maxValue={10_000}
                      value={initialExplantCount}
                      onChange={setInitialExplantCount}
                      isDisabled={busy || designLocked}
                    >
                      <Label>Initial explants</Label>
                      <NumberField.Group>
                        <NumberField.DecrementButton />
                        <NumberField.Input />
                        <NumberField.IncrementButton />
                      </NumberField.Group>
                    </NumberField>
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

function eventDefaults(type: CultureEventType): {
  exclude: boolean;
  remove: boolean;
} {
  if (type === "harvested") return { exclude: false, remove: true };
  if (type === "contaminated") return { exclude: true, remove: false };
  return { exclude: true, remove: true };
}

function CultureEventsModal({
  experiment,
  observationUnit,
  observations,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [type, setType] = useState<CultureEventType>("contaminated");
  const [observation, setObservation] = useState(observations.at(-1)!.id);
  const defaults = eventDefaults(type);
  const [exclude, setExclude] = useState(defaults.exclude);
  const [remove, setRemove] = useState(defaults.remove);
  const [correcting, setCorrecting] = useState<string | null>(null);

  const changeType = (next: CultureEventType) => {
    setType(next);
    const effects = eventDefaults(next);
    setExclude(effects.exclude);
    setRemove(effects.remove);
  };

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                Culture events · {observationUnit.code}
              </Modal.Heading>
              <Description>
                Events preserve what happened. Analysis exclusion and physical
                removal are recorded separately.
              </Description>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-5">
              {observationUnit.events.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {observationUnit.events.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      observation={observations.find(
                        (item) => item.id === event.observation,
                      )}
                      correcting={correcting === event.id}
                      busy={busy}
                      onCorrect={() => setCorrecting(event.id)}
                      onCancel={() => setCorrecting(null)}
                      onSubmit={(reason) => {
                        void run(
                          () =>
                            correctCultureEvent({
                              data: { experiment, event: event.id, reason },
                            }),
                          "Correction not recorded",
                        ).then(async (result) => {
                          if (!result.ok) return;
                          setCorrecting(null);
                          await router.invalidate();
                        });
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <Separator />
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      createCultureEvent({
                        data: {
                          experiment,
                          observationUnit: observationUnit.id,
                          type,
                          observation,
                          excludeFromObservation: exclude,
                          removeAfterObservation: remove,
                          note: String(form.get("note") ?? ""),
                        },
                      }),
                    "Event not recorded",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(`${CULTURE_EVENT_LABELS[type]} recorded`);
                    await router.invalidate();
                    onClose();
                  });
                }}
              >
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <div className="flex w-full gap-3">
                      <Select
                        variant="secondary"
                        fullWidth
                        isDisabled={busy}
                        selectedKey={type}
                        onSelectionChange={(key) =>
                          changeType(String(key) as CultureEventType)
                        }
                      >
                        <Label>Event</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {CULTURE_EVENT_TYPES.map((value) => (
                              <ListBox.Item
                                key={value}
                                id={value}
                                textValue={CULTURE_EVENT_LABELS[value]}
                              >
                                <Label>{CULTURE_EVENT_LABELS[value]}</Label>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Select
                        variant="secondary"
                        fullWidth
                        isDisabled={busy}
                        selectedKey={observation}
                        onSelectionChange={(key) => setObservation(String(key))}
                      >
                        <Label>Observation</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {observations.map((item) => (
                              <ListBox.Item
                                key={item.id}
                                id={item.id}
                                textValue={observationLabel(item)}
                              >
                                <Label>{observationLabel(item)}</Label>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div className="flex w-full gap-3">
                      <Select
                        variant="secondary"
                        fullWidth
                        isDisabled={busy}
                        selectedKey={exclude ? "exclude" : "include"}
                        onSelectionChange={(key) =>
                          setExclude(key === "exclude")
                        }
                      >
                        <Label>Analysis</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="exclude">
                              Exclude from this and later observations
                            </ListBox.Item>
                            <ListBox.Item id="include">
                              Keep in analysis
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Select
                        variant="secondary"
                        fullWidth
                        isDisabled={busy}
                        selectedKey={remove ? "remove" : "keep"}
                        onSelectionChange={(key) => setRemove(key === "remove")}
                      >
                        <Label>After this observation</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="remove">
                              No longer available
                            </ListBox.Item>
                            <ListBox.Item id="keep">
                              Keep available
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <TextField
                      variant="secondary"
                      fullWidth
                      name="note"
                      isDisabled={busy}
                    >
                      <Label>Note</Label>
                      <Input placeholder="What was detected or done" />
                    </TextField>
                  </Fieldset.Group>
                  <Fieldset.Actions>
                    <Button variant="tertiary" onPress={onClose}>
                      Close
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Recording…" : "Record event"}
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

function EventRow({
  event,
  observation,
  correcting,
  busy,
  onCorrect,
  onCancel,
  onSubmit,
}: {
  event: CultureEvent;
  observation: ExperimentObservation | undefined;
  correcting: boolean;
  busy: boolean;
  onCorrect: () => void;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const effects = [
    event.excludeFromObservation
      ? "excluded from analysis"
      : "kept in analysis",
    event.removeAfterObservation ? "removed afterwards" : "kept available",
  ].join(" · ");
  return (
    <div className="rounded-lg border border-default p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{CULTURE_EVENT_LABELS[event.type]}</span>
        <span className="text-sm text-muted">
          {observation ? observationLabel(observation) : "Unknown observation"}{" "}
          · {effects}
        </span>
        {event.voidedAt ? <Chip size="sm">Corrected</Chip> : null}
        {!event.voidedAt && !correcting ? (
          <Button
            className="ms-auto"
            size="sm"
            variant="ghost"
            onPress={onCorrect}
          >
            Correct…
          </Button>
        ) : null}
      </div>
      {event.note ? <p className="mt-1 text-sm">{event.note}</p> : null}
      {event.voidedAt ? (
        <p className="mt-1 text-sm text-muted">
          Correction: {event.voidReason}
        </p>
      ) : null}
      {correcting ? (
        <Form
          className="mt-3"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            const form = new FormData(formEvent.currentTarget);
            onSubmit(String(form.get("reason") ?? ""));
          }}
        >
          <div className="flex w-full items-end gap-2">
            <TextField variant="secondary" fullWidth isRequired name="reason">
              <Label>Correction reason</Label>
              <Input placeholder="Recorded against the wrong observation" />
            </TextField>
            <Button variant="tertiary" isDisabled={busy} onPress={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="secondary" isDisabled={busy}>
              Void record
            </Button>
          </div>
        </Form>
      ) : null}
    </div>
  );
}
