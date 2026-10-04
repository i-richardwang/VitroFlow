import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import { pairInOrder, suggestUnit } from "../../domain/experiments/naming";
import {
  photoConflicts,
  type PhotoConflict,
  type PlacedPhoto,
} from "../../domain/experiments/photos";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { assignImagesToObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { Tag } from "../../ui/kit/Tag";
import { ImageDropZone } from "../upload/ImageDropZone";
import type { ListedImage } from "../upload/state";
import { useUploads } from "../upload/useUploads";
import { observationLabel } from "./labels";

const FORM_ID = "assign-images";

interface AssignImagesDialogProps {
  experiment: string;
  observation: ExperimentObservation;
  units: Unit[];
  assigned: ReadonlySet<string>;
  /** The photographs the experiment already holds. */
  placed: readonly PlacedPhoto[];
  open: boolean;
  onClose: () => void;
}

/** Uploads photographs taken at one observation and matches each to its unit. */
export function AssignImagesDialog(props: AssignImagesDialogProps) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => (
        <AssignImagesSession {...props} afterClose={afterClose} />
      )}
    </DialogSession>
  );
}

function AssignImagesSession({
  experiment,
  observation,
  units,
  assigned,
  placed,
  open,
  onClose,
  afterClose,
}: AssignImagesDialogProps & { afterClose: () => void }) {
  const router = useRouter();
  const uploads = useUploads();
  const action = useAsyncAction();
  const [assignments, setAssignments] = useState<Record<number, string | null>>(
    {},
  );
  const suggested = useRef(new Set<number>());
  const vacantUnits = units.filter((unit) => !assigned.has(unit.id));
  const { images } = uploads;
  const stored = storedPhotos(images);
  const conflicts = photoConflicts(stored, placed);
  const free = stored.filter((photo) => !conflicts.has(photo.id));

  /**
   * Each photograph is guessed once, when it is stored and free to take a
   * unit; a choice made is never undone.
   */
  useEffect(() => {
    const arrived = free.filter((photo) => !suggested.current.has(photo.id));
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
          vacantUnits.map((unit) => unit.code),
        );
        const unit = vacantUnits.find((item) => item.code === code);
        if (!unit || claimed.has(unit.id)) continue;
        claimed.add(unit.id);
        next[photo.id] = unit.id;
      }
      return next;
    });
  }, [images]);

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
      const vacant = vacantUnits
        .filter((unit) => !claimed.has(unit.id))
        .map((unit) => unit.id);
      return {
        ...current,
        ...Object.fromEntries(pairInOrder(waiting, vacant)),
      };
    });
  const vacantLeft = vacantUnits.length - ready.length;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.observation_images_heading({
        observation: observationLabel(observation),
      })}
      okText={
        uploads.storing
          ? m.observation_images_uploading()
          : m.observation_images_assign_count({ count: ready.length })
      }
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={uploads.storing || ready.length === 0 || unassigned > 0}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void action
            .run(
              () =>
                assignImagesToObservation({
                  data: {
                    experiment,
                    observation: observation.id,
                    images: ready,
                  },
                }),
              m.observation_images_assign_failed(),
            )
            .then(async (result) => {
              if (!result.ok) return;
              uploads.clearStored();
              setAssignments({});
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
          disabled={action.busy}
          annotate={(image) => {
            const conflict = conflicts.get(image.id);
            if (conflict) return <ConflictTag conflict={conflict} />;
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
                disabled={action.busy}
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
          <Alert
            type="warning"
            title={m.observation_images_remaining({ count: unassigned })}
            action={
              <Button
                size="small"
                disabled={action.busy || vacantLeft <= 0}
                onClick={fillInOrder}
              >
                {m.observation_images_fill_in_order()}
              </Button>
            }
          />
        ) : null}
      </Form>
    </FormDialog>
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

/** Where a photograph already is, in place of the unit it cannot take. */
function ConflictTag({ conflict }: { conflict: PhotoConflict }) {
  return (
    <Tag color="warning" size="small">
      {conflict.kind === "placed"
        ? m.observation_images_placed({
            unit: conflict.placed.unit,
            day: conflict.placed.day,
          })
        : m.observation_images_repeated({ file: conflict.filename })}
    </Tag>
  );
}

/** The unit a stored photograph shows; clearing it leaves the photograph unmatched. */
function UnitChoice({
  image,
  units,
  unavailable,
  value,
  disabled,
  onChange,
}: {
  image: ListedImage;
  units: Unit[];
  unavailable: ReadonlySet<string>;
  value: string | null;
  disabled: boolean;
  onChange: (unit: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <Select
      aria-label={m.observation_images_unit_label({ file: image.file.name })}
      className="w-28 sm:w-44"
      size="small"
      variant="filled"
      allowClear
      disabled={disabled}
      placeholder={m.observation_images_unassigned()}
      options={units.map((unit) => ({
        label: unit.code,
        value: unit.id,
        disabled: unavailable.has(unit.id),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}
