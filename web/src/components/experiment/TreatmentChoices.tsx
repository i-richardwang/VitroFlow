import { Dropdown, Label, Separator } from "@heroui/react";

import type { Treatment } from "../../experiments/schema";
import { TreatmentDot } from "./TreatmentDot";

const UNASSIGNED = "unassigned";

export function TreatmentChoices({
  label,
  treatments,
  onPick,
}: {
  label: string;
  treatments: Treatment[];
  onPick: (treatment: string | null) => void;
}) {
  return (
    <Dropdown.Popover placement="bottom start">
      <Dropdown.Menu
        aria-label={label}
        onAction={(key) => onPick(key === UNASSIGNED ? null : String(key))}
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
        <Separator />
        <Dropdown.Item id={UNASSIGNED} textValue="Unassigned">
          <TreatmentDot position={null} />
          <Label>Unassigned</Label>
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown.Popover>
  );
}
