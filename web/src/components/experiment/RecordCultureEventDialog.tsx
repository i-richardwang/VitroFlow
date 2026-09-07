import {
  Button,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Unit } from "../../experiments/contracts";
import { cultureEventLabel } from "../../experiments/culture-events";
import {
  CULTURE_EVENT_TYPES,
  observationLabel,
  type CultureEventType,
  type ExperimentObservation,
} from "../../experiments/schema";
import { createCultureEvents } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";

/** Records the same culture event on one or more units at one observation. */
export function RecordCultureEventDialog({
  experiment,
  units,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  units: Unit[];
  observations: ExperimentObservation[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={isOpen ? units.map((unit) => unit.id).join() : "closed"}
      experiment={experiment}
      units={units}
      observations={observations}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({
  experiment,
  units,
  observations,
  isOpen,
  onClose,
}: {
  experiment: string;
  units: Unit[];
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
                      createCultureEvents({
                        data: {
                          experiment,
                          units: units.map((unit) => unit.id),
                          type,
                          observation,
                        },
                      }),
                    m.culture_event_not_recorded(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(
                      m.culture_event_recorded_for({
                        event: cultureEventLabel(type),
                        count: units.length,
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
                isDisabled={busy || units.length === 0 || observation === ""}
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
