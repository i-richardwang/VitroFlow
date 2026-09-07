import {
  Button,
  Dropdown,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
  Separator,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type {
  ExperimentObservationImage,
  Unit,
  UnitNavigationEntry,
} from "../../experiments/contracts";
import { cultureEventLabel } from "../../experiments/culture-events";
import {
  CULTURE_EVENT_TYPES,
  observationLabel,
  type CultureEventType,
  type ExperimentObservation,
  type Treatment,
} from "../../experiments/schema";
import {
  createCultureEvent,
  removeCultureEvent,
  removeUnit,
  unassignObservationImage,
} from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { MoreIcon } from "../icons";
import { ReassignObservationImageModal } from "./ReassignObservationImageModal";
import { UnitDialog } from "./UnitDialog";

type Action = "reassign" | "edit" | "record" | "remove-event" | "delete";

export function UnitMenu({
  experiment,
  unit,
  treatments,
  observations,
  canRemove,
  image,
  navigation,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  observations: ExperimentObservation[];
  canRemove: boolean;
  image: ExperimentObservationImage | null;
  navigation: UnitNavigationEntry[];
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [open, setOpen] = useState<Action | null>(null);
  const unassign = async () => {
    if (!image) return;
    await unassignObservationImage({ data: image.ref });
    toast.success(m.unit_image_unassigned());
    await router.navigate({
      to: "/experiments/$experiment",
      params: { experiment: image.ref.experiment },
    });
  };

  return (
    <>
      <Dropdown>
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          aria-label={m.unit_actions({
            code: unit.code,
          })}
        >
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={m.unit_actions({
              code: unit.code,
            })}
            disabledKeys={busy ? ["unassign"] : []}
            onAction={(key) => {
              if (key !== "unassign") return setOpen(key as Action);
              void run(unassign, m.unit_image_not_unassigned());
            }}
          >
            {image ? (
              <Dropdown.Item id="reassign" textValue={m.unit_reassign_image()}>
                <Label>{m.unit_menu_reassign()}</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="edit" textValue={m.unit_edit()}>
              <Label>{m.unit_menu_edit()}</Label>
            </Dropdown.Item>
            {observations.length > 0 ? (
              <Dropdown.Item id="record" textValue={m.culture_event_record()}>
                <Label>{m.culture_event_menu_record()}</Label>
              </Dropdown.Item>
            ) : null}
            {unit.events.length > 0 ? (
              <Dropdown.Item
                id="remove-event"
                textValue={m.culture_event_remove()}
              >
                <Label>{m.culture_event_menu_remove()}</Label>
              </Dropdown.Item>
            ) : null}
            {image || canRemove ? <Separator orientation="horizontal" /> : null}
            {image ? (
              <Dropdown.Item
                id="unassign"
                textValue={m.unit_unassign_image()}
                variant="danger"
              >
                <Label>{m.unit_unassign_image()}</Label>
              </Dropdown.Item>
            ) : null}
            {canRemove ? (
              <Dropdown.Item
                id="delete"
                textValue={m.unit_delete()}
                variant="danger"
              >
                <Label>{m.unit_menu_delete()}</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <UnitDialog
        experiment={experiment}
        unit={unit}
        treatments={treatments}
        isOpen={open === "edit"}
        onClose={() => setOpen(null)}
      />

      <RecordCultureEventModal
        key={open === "record" ? "recording" : "idle"}
        experiment={experiment}
        unit={unit}
        observations={observations}
        isOpen={open === "record"}
        onClose={() => setOpen(null)}
      />

      <RemoveCultureEventModal
        key={open === "remove-event" ? "removing" : "idle"}
        experiment={experiment}
        unit={unit}
        observations={observations}
        isOpen={open === "remove-event"}
        onClose={() => setOpen(null)}
      />

      {image ? (
        <ReassignObservationImageModal
          image={image}
          navigation={navigation}
          observations={observations}
          isOpen={open === "reassign"}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <DestructiveActionDialog
        isOpen={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
        title={m.unit_delete_title({ code: unit.code })}
        confirmLabel={m.unit_delete()}
        onConfirm={async () => {
          await removeUnit({
            data: { experiment, unit: unit.id },
          });
          toast.success(m.unit_deleted({ code: unit.code }));
          await router.invalidate();
        }}
      />
    </>
  );
}

function RecordCultureEventModal({
  experiment,
  unit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  unit: Unit;
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.culture_event_record()}</Modal.Heading>
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
                          unit: unit.id,
                          type,
                          observation,
                        },
                      }),
                    m.culture_event_not_recorded(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(
                      m.culture_event_recorded({
                        event: cultureEventLabel(type),
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
                  selectedKey={type}
                  onSelectionChange={(key) =>
                    setType(String(key) as CultureEventType)
                  }
                >
                  <Label>{m.culture_event_label()}</Label>
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
                  <Label>{m.observation_label()}</Label>
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
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="record-culture-event"
                variant="primary"
                isDisabled={busy}
              >
                {busy
                  ? m.culture_event_recording()
                  : m.culture_event_record_action()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function RemoveCultureEventModal({
  experiment,
  unit,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const { events } = unit;
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.culture_event_remove()}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="remove-culture-event"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  void run(
                    () => removeCultureEvent({ data: { experiment, event } }),
                    m.culture_event_not_removed(),
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
                  <Label>{m.culture_event_label()}</Label>
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
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="remove-culture-event"
                variant="danger"
                isDisabled={busy || event === ""}
              >
                {busy
                  ? m.culture_event_removing()
                  : m.culture_event_remove_action()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
