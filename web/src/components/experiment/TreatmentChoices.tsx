import { Button, Dropdown, Label, Separator, Tooltip } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { ObservationUnit } from "../../experiments/contracts";
import type { Treatment } from "../../experiments/schema";
import { assignObservationUnitsToTreatment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { TreatmentDot } from "./TreatmentDot";

const UNASSIGNED = "unassigned";
const NEW = "new";
const EDIT = "edit";

export function TreatmentChoices({
  label,
  treatments,
  onPick,
  onNew,
  editing,
  onEdit,
}: {
  label: string;
  treatments: Treatment[];
  onPick: (treatment: string | null) => void;
  onNew: () => void;
  editing?: Treatment | null;
  onEdit?: (treatment: string) => void;
}) {
  return (
    <Dropdown.Popover placement="bottom start">
      <Dropdown.Menu
        aria-label={label}
        onAction={(key) => {
          const id = String(key);
          if (id === NEW) {
            onNew();
            return;
          }
          if (id === EDIT && editing) {
            onEdit?.(editing.id);
            return;
          }
          onPick(id === UNASSIGNED ? null : id);
        }}
      >
        {treatments.map((treatment) => (
          <Dropdown.Item
            key={treatment.id}
            id={treatment.id}
            textValue={treatment.name}
          >
            <TreatmentDot position={treatment.position} />
            <Label>{treatment.name}</Label>
          </Dropdown.Item>
        ))}
        <Dropdown.Item id={UNASSIGNED} textValue="No treatment">
          <TreatmentDot position={null} />
          <Label>No treatment</Label>
        </Dropdown.Item>
        <Separator orientation="horizontal" />
        <Dropdown.Item id={NEW} textValue="New treatment">
          <Label>New treatment…</Label>
        </Dropdown.Item>
        {editing && onEdit ? (
          <Dropdown.Item id={EDIT} textValue={`Edit ${editing.name}`}>
            <Label>Edit {editing.name}…</Label>
          </Dropdown.Item>
        ) : null}
      </Dropdown.Menu>
    </Dropdown.Popover>
  );
}

/** The color of an observation unit: shows its treatment and reassigns it. */
export function ObservationUnitTreatmentMenu({
  experiment,
  observationUnit,
  treatments,
  onEdit,
  onNew,
}: {
  experiment: string;
  observationUnit: ObservationUnit;
  treatments: Treatment[];
  onEdit: (treatment: string) => void;
  onNew: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const current =
    treatments.find(
      (treatment) => treatment.id === observationUnit.treatment,
    ) ?? null;
  const name = current?.name ?? "No treatment";

  return (
    <Dropdown>
      <Tooltip delay={0}>
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          isDisabled={busy}
          aria-label={`Treatment of ${observationUnit.code}`}
        >
          <TreatmentDot position={current?.position ?? null} />
        </Button>
        <Tooltip.Content>{name}</Tooltip.Content>
      </Tooltip>
      <TreatmentChoices
        label={`Treatment of ${observationUnit.code}`}
        treatments={treatments}
        onPick={(treatment) => {
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
        }}
        onNew={onNew}
        editing={current}
        onEdit={onEdit}
      />
    </Dropdown>
  );
}
