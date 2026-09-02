import {
  Button,
  Description,
  Dropdown,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ObservationUnit } from "../../experiments/contracts";
import {
  cultureEventExcludesFromAnalysisByDefault,
  cultureEventIsTerminal,
  cultureEventLabel,
} from "../../experiments/culture-events";
import {
  CULTURE_EVENT_TYPES,
  observationLabel,
  type CultureEventType,
  type ExperimentObservation,
} from "../../experiments/schema";
import {
  correctCultureEvent,
  createCultureEvent,
  editObservationUnit,
  removeObservationUnit,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DeleteDialog } from "../DeleteDialog";
import { MoreIcon } from "../icons";

type Action = "edit" | "record" | "correct" | "delete";

export function ObservationUnitMenu({
  experiment,
  observationUnit,
  observations,
  canRemove,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  canRemove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <>
      <Dropdown>
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          aria-label={`Observation unit ${observationUnit.code}`}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom start">
          <Dropdown.Menu
            aria-label={`Observation unit ${observationUnit.code}`}
            onAction={(key) => setOpen(String(key) as Action)}
          >
            <Dropdown.Item id="edit" textValue="Edit observation unit">
              <Label>Edit observation unit…</Label>
            </Dropdown.Item>
            {observations.length > 0 ? (
              <Dropdown.Item id="record" textValue="Record culture event">
                <Label>Record culture event…</Label>
              </Dropdown.Item>
            ) : null}
            {observationUnit.events.some((event) => event.voidedAt === null) ? (
              <Dropdown.Item id="correct" textValue="Correct culture event">
                <Label>Correct culture event…</Label>
              </Dropdown.Item>
            ) : null}
            {canRemove ? (
              <>
                <Separator orientation="horizontal" />
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

      <EditObservationUnitModal
        experiment={experiment}
        observationUnit={observationUnit}
        isOpen={open === "edit"}
        onClose={() => setOpen(null)}
      />

      <RecordCultureEventDialog
        experiment={experiment}
        observationUnit={observationUnit}
        observations={observations}
        isOpen={open === "record"}
        onClose={() => setOpen(null)}
      />

      <CorrectCultureEventDialog
        experiment={experiment}
        observationUnit={observationUnit}
        observations={observations}
        isOpen={open === "correct"}
        onClose={() => setOpen(null)}
      />

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
        This observation unit is removed from the experiment.
      </DeleteDialog>
    </>
  );
}

function EditObservationUnitModal({
  experiment,
  observationUnit,
  isOpen,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
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
            <Modal.Body key={isOpen ? "open" : "closed"}>
              <Form
                id="edit-observation-unit"
                className="flex w-full min-w-0 flex-col gap-4"
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
                <TextField
                  variant="secondary"
                  fullWidth
                  isRequired
                  isDisabled={busy}
                  name="code"
                  defaultValue={observationUnit.code}
                >
                  <Label>Code</Label>
                  <Input className="w-full" />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="edit-observation-unit"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function RecordCultureEventDialog({
  experiment,
  observationUnit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <RecordCultureEventForm
      key={isOpen ? "open" : "closed"}
      experiment={experiment}
      observationUnit={observationUnit}
      observations={observations}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function RecordCultureEventForm({
  experiment,
  observationUnit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [type, setType] = useState<CultureEventType>("contaminated");
  const [observation, setObservation] = useState(observations.at(-1)?.id ?? "");
  const [exclude, setExclude] = useState(
    cultureEventExcludesFromAnalysisByDefault(type),
  );

  const changeType = (next: CultureEventType) => {
    setType(next);
    setExclude(cultureEventExcludesFromAnalysisByDefault(next));
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Record culture event</Modal.Heading>
              <Description>
                Event type determines whether {observationUnit.code} remains on
                the bench. Analysis inclusion is recorded separately.
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="record-culture-event"
                className="flex w-full min-w-0 flex-col gap-4"
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
                          note: String(form.get("note") ?? ""),
                        },
                      }),
                    "Event not recorded",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(`${cultureEventLabel(type)} recorded`);
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
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
                          textValue={cultureEventLabel(value)}
                        >
                          {cultureEventLabel(value)}
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
                          {observationLabel(item)}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Description>
                  {cultureEventIsTerminal(type)
                    ? "This event takes the unit off the bench after the selected observation."
                    : "This event leaves the unit available after the selected observation."}
                </Description>
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={exclude ? "exclude" : "include"}
                  onSelectionChange={(key) => setExclude(key === "exclude")}
                >
                  <Label>Analysis</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item
                        id="exclude"
                        textValue="Exclude from this and later observations"
                      >
                        Exclude from this and later observations
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                      <ListBox.Item id="include" textValue="Keep in analysis">
                        Keep in analysis
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <TextField
                  variant="secondary"
                  fullWidth
                  name="note"
                  isDisabled={busy}
                >
                  <Label>Note</Label>
                  <Input
                    className="w-full"
                    placeholder="What was detected or done"
                  />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="record-culture-event"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? "Recording…" : "Record"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function CorrectCultureEventDialog({
  experiment,
  observationUnit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <CorrectCultureEventForm
      key={isOpen ? "open" : "closed"}
      experiment={experiment}
      observationUnit={observationUnit}
      observations={observations}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function CorrectCultureEventForm({
  experiment,
  observationUnit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const active = observationUnit.events.filter(
    (event) => event.voidedAt === null,
  );
  const [event, setEvent] = useState(active.at(-1)?.id ?? "");

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Correct culture event</Modal.Heading>
              <Description>
                The record stays in the notebook as voided.
              </Description>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="correct-culture-event"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  const form = new FormData(formEvent.currentTarget);
                  void run(
                    () =>
                      correctCultureEvent({
                        data: {
                          experiment,
                          event,
                          reason: String(form.get("reason") ?? ""),
                        },
                      }),
                    "Correction not recorded",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                {active.length > 1 ? (
                  <Select
                    variant="secondary"
                    fullWidth
                    isDisabled={busy}
                    selectedKey={event}
                    onSelectionChange={(key) => setEvent(String(key))}
                  >
                    <Label>Event</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {active.map((item) => {
                          const observation = observations.find(
                            (entry) => entry.id === item.observation,
                          );
                          const text = [
                            cultureEventLabel(item.type),
                            observation ? observationLabel(observation) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <ListBox.Item
                              key={item.id}
                              id={item.id}
                              textValue={text}
                            >
                              {text}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          );
                        })}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : null}
                <TextField
                  variant="secondary"
                  fullWidth
                  isRequired
                  isDisabled={busy}
                  name="reason"
                >
                  <Label>Correction reason</Label>
                  <Input
                    className="w-full"
                    placeholder="Recorded against the wrong observation"
                  />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="correct-culture-event"
                variant="danger"
                isDisabled={busy || event === ""}
              >
                {busy ? "Voiding…" : "Void record"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
