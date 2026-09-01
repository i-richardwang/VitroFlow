import { Input, Label, TextField } from "@heroui/react";

import type { TreatmentFactor } from "../../experiments/schema";

const EMPTY_FACTOR: TreatmentFactor = { name: "", level: "", unit: "" };

export function submittedFactor(
  factor: TreatmentFactor,
): TreatmentFactor | null {
  const name = factor.name.trim();
  const level = factor.level.trim();
  const unit = factor.unit.trim();
  if (!name || !level) return null;
  return { name, level, unit };
}

export function FactorField({
  busy,
  factor,
  onChange,
}: {
  busy: boolean;
  factor: TreatmentFactor;
  onChange: (factor: TreatmentFactor) => void;
}) {
  return (
    <>
      <TextField
        fullWidth
        variant="secondary"
        isDisabled={busy}
        value={factor.name}
        onChange={(name) => onChange({ ...factor, name })}
      >
        <Label>Factor</Label>
        <Input className="w-full" placeholder="6-BA" />
      </TextField>
      <TextField
        fullWidth
        variant="secondary"
        isDisabled={busy}
        value={factor.level}
        onChange={(level) => onChange({ ...factor, level })}
      >
        <Label>Level</Label>
        <Input className="w-full" placeholder="1.0" />
      </TextField>
      <TextField
        fullWidth
        variant="secondary"
        isDisabled={busy}
        value={factor.unit}
        onChange={(unit) => onChange({ ...factor, unit })}
      >
        <Label>Unit</Label>
        <Input className="w-full" placeholder="mg/L" />
      </TextField>
    </>
  );
}

export function factorDraft(factor: TreatmentFactor | null): TreatmentFactor {
  return factor ?? EMPTY_FACTOR;
}
