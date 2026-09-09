import { InlineSelect } from "@heroui-pro/react/inline-select";
import { Alert, Button, Form, ListBox, Modal, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { Unit } from "../../experiments/contracts";
import { pairInOrder, suggestUnit } from "../../experiments/naming";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import { assignImagesToObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { Hint } from "../Hint";
import { ImageDropZone, type ListedImage } from "../ImageDropZone";
import { useUploads } from "./uploads";

const UNASSIGNED = "unassigned";

export function AssignImagesDialog({
  experiment,
  observation,
  units,
  assigned,
  isOpen,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  units: Unit[];
  assigned: ReadonlySet<string>;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const uploads = useUploads();
  const { busy, run } = useAsyncAction();
  const [assignments, setAssignments] = useState<Record<number, string | null>>(
    {},
  );
  const suggested = useRef(new Set<number>());
  const open = units.filter((unit) => !assigned.has(unit.id));
  const openUnits = useRef(open);
  openUnits.current = open;

  /** Each file is guessed once, when it arrives; a choice made is never undone. */
  const { images } = uploads;
  useEffect(() => {
    const arrived = images.filter((image) => !suggested.current.has(image.id));
    if (arrived.length === 0) return;
    for (const image of arrived) suggested.current.add(image.id);
    setAssignments((current) => {
      const claimed = new Set(
        Object.values(current).filter((unit): unit is string => unit !== null),
      );
      const next = { ...current };
      for (const image of arrived) {
        const code = suggestUnit(
          image.file.name,
          openUnits.current.map((unit) => unit.code),
        );
        const unit = openUnits.current.find((item) => item.code === code);
        if (!unit || claimed.has(unit.id)) continue;
        claimed.add(unit.id);
        next[image.id] = unit.id;
      }
      return next;
    });
  }, [images]);

  const ready = uploads.images.flatMap((image) => {
    if (image.state.status !== "stored") return [];
    const unit = assignments[image.id];
    if (!unit) return [];
    return [
      {
        unit,
        digest: image.state.digest,
        filename: image.file.name,
      },
    ];
  });
  const stored = uploads.images.filter(
    (image) => image.state.status === "stored",
  );
  const unassigned = stored.length - ready.length;

  /** Camera names say nothing about dishes; shooting order does. */
  const fillInOrder = () =>
    setAssignments((current) => {
      const claimed = new Set(
        Object.values(current).filter((unit): unit is string => unit !== null),
      );
      const waiting = stored
        .filter((image) => !current[image.id])
        .map((image) => ({ id: image.id, filename: image.file.name }));
      const vacant = open
        .filter((unit) => !claimed.has(unit.id))
        .map((unit) => unit.id);
      return {
        ...current,
        ...Object.fromEntries(pairInOrder(waiting, vacant)),
      };
    });
  const vacantLeft = open.length - ready.length;

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>
                {m.observation_images_heading({
                  observation: observationLabel(observation),
                })}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="assign-images"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      assignImagesToObservation({
                        data: {
                          experiment,
                          observation: observation.id,
                          images: ready,
                        },
                      }),
                    m.observation_images_not_assigned(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    uploads.clearStored();
                    setAssignments({});
                    const count = result.value.assigned;
                    toast.success(
                      m.observation_images_assigned({
                        count,
                        observation: observationLabel(observation),
                      }),
                    );
                    await router.invalidate();
                    if (!uploads.failed) onClose();
                  });
                }}
              >
                <ImageDropZone
                  images={uploads.images}
                  onAdd={uploads.add}
                  onRemove={(id) => {
                    uploads.remove(id);
                    setAssignments(({ [id]: _removed, ...rest }) => rest);
                  }}
                  busy={busy}
                  annotate={(image) => (
                    <UnitChoice
                      image={image}
                      units={units}
                      unavailable={
                        new Set([
                          ...assigned,
                          ...Object.entries(assignments)
                            .filter(
                              ([id, unit]) =>
                                unit !== null && Number(id) !== image.id,
                            )
                            .map(([, unit]) => unit!),
                        ])
                      }
                      value={assignments[image.id] ?? null}
                      busy={busy}
                      onChange={(unit) =>
                        setAssignments((current) => ({
                          ...current,
                          [image.id]: unit,
                        }))
                      }
                    />
                  )}
                />
                {unassigned > 0 ? (
                  <Hint text={m.observation_images_fill_in_order_hint()}>
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={busy || vacantLeft <= 0}
                      onPress={fillInOrder}
                    >
                      {m.observation_images_fill_in_order()}
                    </Button>
                  </Hint>
                ) : null}
                {unassigned > 0 ? (
                  <Alert status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>
                        {m.observation_images_remaining({
                          count: unassigned,
                        })}
                      </Alert.Title>
                    </Alert.Content>
                  </Alert>
                ) : null}
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="assign-images"
                variant="primary"
                isDisabled={
                  busy ||
                  uploads.storing ||
                  ready.length === 0 ||
                  unassigned > 0
                }
              >
                {busy
                  ? m.observation_images_assigning()
                  : uploads.storing
                    ? m.observation_images_uploading()
                    : m.observation_images_assign_count({
                        count: ready.length,
                      })}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function UnitChoice({
  image,
  units,
  unavailable,
  value,
  busy,
  onChange,
}: {
  image: ListedImage;
  units: Unit[];
  unavailable: ReadonlySet<string>;
  value: string | null;
  busy: boolean;
  onChange: (unit: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <InlineSelect
      aria-label={m.observation_images_unit_label({ file: image.file.name })}
      isDisabled={busy}
      disabledKeys={[...unavailable]}
      selectedKey={value ?? UNASSIGNED}
      onSelectionChange={(key) =>
        onChange(key === UNASSIGNED ? null : String(key))
      }
    >
      <InlineSelect.Trigger>
        <InlineSelect.Value />
        <InlineSelect.Indicator />
      </InlineSelect.Trigger>
      <InlineSelect.Popover className="w-48">
        <ListBox>
          <ListBox.Item
            id={UNASSIGNED}
            textValue={m.observation_images_unassigned()}
          >
            {m.observation_images_unassigned()}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {units.map((unit) => (
            <ListBox.Item key={unit.id} id={unit.id} textValue={unit.code}>
              {unit.code}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </InlineSelect.Popover>
    </InlineSelect>
  );
}
