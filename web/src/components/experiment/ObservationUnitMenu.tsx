import {
  Button,
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

import type {
  ExperimentObservationImage,
  ObservationUnit,
  ObservationUnitNavigationEntry,
} from "../../experiments/contracts";
import { cultureEventLabel } from "../../experiments/culture-events";
import {
  CULTURE_EVENT_TYPES,
  observationLabel,
  type CultureEventType,
  type ExperimentObservation,
} from "../../experiments/schema";
import {
  createCultureEvent,
  deleteCultureEvent,
  editObservationUnit,
  removeObservationUnit,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { MoreIcon } from "../icons";
import {
  ReassignObservationImageModal,
  UnassignObservationImageDialog,
} from "./ObservationImageDialogs";

type Action =
  "reassign" | "unassign" | "edit" | "record" | "remove-event" | "delete";

export function ObservationUnitMenu({
  experiment,
  observationUnit,
  observations,
  canRemove,
  image,
  navigation,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  observations: ExperimentObservation[];
  canRemove: boolean;
  image?: ExperimentObservationImage;
  navigation?: ObservationUnitNavigationEntry[];
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
          aria-label={`${observationUnit.code} actions`}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={`${observationUnit.code} actions`}
            onAction={(key) => setOpen(String(key) as Action)}
          >
            {image ? (
              <Dropdown.Item id="reassign" textValue="Reassign image">
                <Label>Reassign image…</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="edit" textValue="Edit observation unit">
              <Label>Edit observation unit…</Label>
            </Dropdown.Item>
            {observations.length > 0 ? (
              <Dropdown.Item id="record" textValue="Record culture event">
                <Label>Record culture event…</Label>
              </Dropdown.Item>
            ) : null}
            {observationUnit.events.length > 0 ? (
              <Dropdown.Item id="remove-event" textValue="Remove culture event">
                <Label>Remove culture event…</Label>
              </Dropdown.Item>
            ) : null}
            {image || canRemove ? <Separator orientation="horizontal" /> : null}
            {image ? (
              <Dropdown.Item
                id="unassign"
                textValue="Unassign image"
                variant="danger"
              >
                <Label>Unassign image…</Label>
              </Dropdown.Item>
            ) : null}
            {canRemove ? (
              <Dropdown.Item
                id="delete"
                textValue="Delete observation unit"
                variant="danger"
              >
                <Label>Delete observation unit…</Label>
              </Dropdown.Item>
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

      <RemoveCultureEventDialog
        experiment={experiment}
        observationUnit={observationUnit}
        observations={observations}
        isOpen={open === "remove-event"}
        onClose={() => setOpen(null)}
      />

      {image && navigation ? (
        <ReassignObservationImageModal
          image={image}
          navigation={navigation}
          observations={observations}
          isOpen={open === "reassign"}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {image ? (
        <UnassignObservationImageDialog
          image={image}
          isOpen={open === "unassign"}
          onOpenChange={(next) => setOpen(next ? "unassign" : null)}
        />
      ) : null}

      <DestructiveActionDialog
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
      />
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

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Record culture event</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="record-culture-event"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      createCultureEvent({
                        data: {
                          experiment,
                          observationUnit: observationUnit.id,
                          type,
                          observation,
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
                    setType(String(key) as CultureEventType)
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

function RemoveCultureEventDialog({
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
    <RemoveCultureEventForm
      key={isOpen ? "open" : "closed"}
      experiment={experiment}
      observationUnit={observationUnit}
      observations={observations}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function RemoveCultureEventForm({
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
  const { events } = observationUnit;
  const [event, setEvent] = useState(events.at(-1)?.id ?? "");
  const describe = (item: (typeof events)[number]) => {
    const observation = observations.find(
      (entry) => entry.id === item.observation,
    );
    return observation
      ? `${cultureEventLabel(item.type)} · ${observationLabel(observation)}`
      : cultureEventLabel(item.type);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Remove culture event</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="remove-culture-event"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void run(
                    () => deleteCultureEvent({ data: { experiment, event } }),
                    "Event not removed",
                  ).then(async (result) => {
                    if (!result.ok) return;
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
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
                      {events.map((item) => (
                        <ListBox.Item
                          key={item.id}
                          id={item.id}
                          textValue={describe(item)}
                        >
                          {describe(item)}
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
                form="remove-culture-event"
                variant="danger"
                isDisabled={busy || event === ""}
              >
                {busy ? "Removing…" : "Remove event"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
