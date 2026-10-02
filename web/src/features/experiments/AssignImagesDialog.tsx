import { InlineSelect } from "@heroui-pro/react/inline-select";
import {
  Alert,
  Button,
  Chip,
  Form,
  ListBox,
  Modal,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import { pairInOrder, suggestUnit } from "../../domain/experiments/naming";
import {
  photoConflicts,
  type PhotoConflict,
  type PlacedPhoto,
} from "../../domain/experiments/photos";
import { observationLabel } from "./labels";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { assignImagesToObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { ImageDropZone } from "../upload/ImageDropZone";
import type { ListedImage } from "../upload/state";
import { useUploads } from "../upload/useUploads";

const UNASSIGNED = "unassigned";

export function AssignImagesDialog({
  experiment,
  observation,
  units,
  assigned,
  placed,
  isOpen,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  units: Unit[];
  assigned: ReadonlySet<string>;
  /** The photographs the experiment already holds. */
  placed: readonly PlacedPhoto[];
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
  const placedPhotos = useRef(placed);
  placedPhotos.current = placed;

  /**
   * Each photograph is guessed once, when it is stored and free to take a
   * unit; a choice made is never undone.
   */
  const { images } = uploads;
  useEffect(() => {
    const arrived = freePhotos(
      storedPhotos(images),
      placedPhotos.current,
    ).filter((photo) => !suggested.current.has(photo.id));
    if (arrived.length === 0) return;
    for (const photo of arrived) suggested.current.add(photo.id);
    setAssignments((current) => {
      const claimed = new Set(
        Object.values(current).filter((unit): unit is string => unit !== null),
      );
      const next = { ...current };
      for (const photo of arrived) {
        const code = suggestUnit(
          photo.filename,
          openUnits.current.map((unit) => unit.code),
        );
        const unit = openUnits.current.find((item) => item.code === code);
        if (!unit || claimed.has(unit.id)) continue;
        claimed.add(unit.id);
        next[photo.id] = unit.id;
      }
      return next;
    });
  }, [images]);

  const stored = storedPhotos(uploads.images);
  const conflicts = photoConflicts(stored, placed);
  const free = stored.filter((photo) => !conflicts.has(photo.id));
  const chosen = new Map(
    free.flatMap((photo) => {
      const unit = assignments[photo.id];
      return unit ? [[photo.id, unit] as const] : [];
    }),
  );
  const ready = free.flatMap((photo) => {
    const unit = chosen.get(photo.id);
    return unit
      ? [{ unit, digest: photo.digest, filename: photo.filename }]
      : [];
  });
  const unassigned = free.length - ready.length;

  /** Camera names say nothing about dishes; shooting order does. */
  const fillInOrder = () =>
    setAssignments((current) => {
      const claimed = new Set(free.flatMap((photo) => current[photo.id] ?? []));
      const waiting = free.filter((photo) => !current[photo.id]);
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
                    m.observation_images_assign_failed(),
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
                  annotate={(image) => {
                    const conflict = conflicts.get(image.id);
                    if (conflict) return <ConflictChip conflict={conflict} />;
                    return (
                      <UnitChoice
                        image={image}
                        units={units}
                        unavailable={
                          new Set([
                            ...assigned,
                            ...[...chosen]
                              .filter(([id]) => id !== image.id)
                              .map(([, unit]) => unit),
                          ])
                        }
                        value={chosen.get(image.id) ?? null}
                        busy={busy}
                        onChange={(unit) =>
                          setAssignments((current) => ({
                            ...current,
                            [image.id]: unit,
                          }))
                        }
                      />
                    );
                  }}
                />
                {unassigned > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={busy || vacantLeft <= 0}
                    onPress={fillInOrder}
                  >
                    {m.observation_images_fill_in_order()}
                  </Button>
                ) : null}
                {conflicts.size > 0 ? (
                  <Alert status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>
                        {m.observation_images_skipped({
                          count: conflicts.size,
                        })}
                      </Alert.Title>
                    </Alert.Content>
                  </Alert>
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

interface StoredPhoto {
  id: number;
  digest: string;
  filename: string;
}

function storedPhotos(images: readonly ListedImage[]): StoredPhoto[] {
  return images.flatMap((image) =>
    image.state.status === "stored"
      ? [
          {
            id: image.id,
            digest: image.state.digest,
            filename: image.file.name,
          },
        ]
      : [],
  );
}

function freePhotos(
  stored: readonly StoredPhoto[],
  placed: readonly PlacedPhoto[],
): StoredPhoto[] {
  const conflicts = photoConflicts(stored, placed);
  return stored.filter((photo) => !conflicts.has(photo.id));
}

/** Where a photograph already is, in place of the unit it cannot take. */
function ConflictChip({ conflict }: { conflict: PhotoConflict }) {
  return (
    <Chip color="warning" variant="soft" size="sm">
      {conflict.kind === "placed"
        ? m.observation_images_placed({
            unit: conflict.placed.unit,
            day: conflict.placed.day,
          })
        : m.observation_images_repeated({ file: conflict.filename })}
    </Chip>
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
