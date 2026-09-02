import { InlineSelect } from "@heroui-pro/react/inline-select";
import { Alert, Button, Form, ListBox, Modal, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { ObservationUnit } from "../../experiments/contracts";
import { suggestObservationUnit } from "../../experiments/naming";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import { assignImagesToObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { ImageDropZone, type ListedImage } from "../ImageDropZone";
import { useUploads } from "./uploads";

const UNASSIGNED = "unassigned";

export function AssignImagesDialog({
  experiment,
  observation,
  observationUnits,
  assigned,
  isOpen,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  observationUnits: ObservationUnit[];
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

  const open = observationUnits.filter(
    (observationUnit) => !assigned.has(observationUnit.id),
  );
  const openObservationUnits = useRef(open);
  openObservationUnits.current = open;

  /** Each file is guessed once, when it arrives; a choice made is never undone. */
  const { images } = uploads;
  useEffect(() => {
    const arrived = images.filter((image) => !suggested.current.has(image.id));
    if (arrived.length === 0) return;
    for (const image of arrived) suggested.current.add(image.id);
    setAssignments((current) => {
      const claimed = new Set(
        Object.values(current).filter(
          (observationUnit): observationUnit is string =>
            observationUnit !== null,
        ),
      );
      const next = { ...current };
      for (const image of arrived) {
        const code = suggestObservationUnit(
          image.file.name,
          openObservationUnits.current.map(
            (observationUnit) => observationUnit.code,
          ),
        );
        const observationUnit = openObservationUnits.current.find(
          (item) => item.code === code,
        );
        if (!observationUnit || claimed.has(observationUnit.id)) continue;
        claimed.add(observationUnit.id);
        next[image.id] = observationUnit.id;
      }
      return next;
    });
  }, [images]);

  const ready = uploads.images.flatMap((image) => {
    if (image.state.status !== "stored") return [];
    const observationUnit = assignments[image.id];
    if (!observationUnit) return [];
    return [
      {
        observationUnit,
        digest: image.state.digest,
        filename: image.file.name,
      },
    ];
  });
  const stored = uploads.images.filter(
    (image) => image.state.status === "stored",
  );
  const unassigned = stored.length - ready.length;

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                Images for {observationLabel(observation)}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {open.length === 0 ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>
                      Every observation unit has an image
                    </Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : (
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
                      "No images were assigned",
                    ).then(async (result) => {
                      if (!result.ok) return;
                      uploads.clearStored();
                      setAssignments({});
                      const count = result.value.assigned;
                      toast.success(
                        `${count} ${count === 1 ? "image" : "images"} assigned to ${observationLabel(observation)}`,
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
                      <ObservationUnitChoice
                        image={image}
                        observationUnits={open}
                        taken={
                          new Set(
                            Object.entries(assignments)
                              .filter(
                                ([id, observationUnit]) =>
                                  observationUnit !== null &&
                                  Number(id) !== image.id,
                              )
                              .map(([, observationUnit]) => observationUnit!),
                          )
                        }
                        value={assignments[image.id] ?? null}
                        busy={busy}
                        onChange={(observationUnit) =>
                          setAssignments((current) => ({
                            ...current,
                            [image.id]: observationUnit,
                          }))
                        }
                      />
                    )}
                  />
                  {unassigned > 0 ? (
                    <Alert status="warning">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          {unassigned === 1
                            ? "Assign the remaining image"
                            : `Assign the remaining ${unassigned} images`}
                        </Alert.Title>
                      </Alert.Content>
                    </Alert>
                  ) : null}
                </Form>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              {open.length === 0 ? null : (
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
                    ? "Assigning…"
                    : uploads.storing
                      ? "Uploading…"
                      : `Assign ${ready.length}`}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ObservationUnitChoice({
  image,
  observationUnits,
  taken,
  value,
  busy,
  onChange,
}: {
  image: ListedImage;
  observationUnits: ObservationUnit[];
  taken: ReadonlySet<string>;
  value: string | null;
  busy: boolean;
  onChange: (observationUnit: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <InlineSelect
      aria-label={`Observation unit shown by ${image.file.name}`}
      isDisabled={busy}
      disabledKeys={[...taken]}
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
          <ListBox.Item id={UNASSIGNED} textValue="Unassigned">
            Unassigned
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {observationUnits.map((observationUnit) => (
            <ListBox.Item
              key={observationUnit.id}
              id={observationUnit.id}
              textValue={observationUnit.code}
            >
              {observationUnit.code}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </InlineSelect.Popover>
    </InlineSelect>
  );
}
