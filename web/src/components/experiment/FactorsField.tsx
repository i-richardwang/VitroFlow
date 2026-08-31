import { Button, Input, Label, TextField, Tooltip } from "@heroui/react";

import type { TreatmentFactor } from "../../experiments/schema";
import { CloseIcon } from "../icons";

export const EMPTY_FACTOR: TreatmentFactor = { name: "", level: "", unit: "" };

export function filledFactors(
  factors: readonly TreatmentFactor[],
): TreatmentFactor[] {
  return factors
    .map((factor) => ({
      name: factor.name.trim(),
      level: factor.level.trim(),
      unit: factor.unit.trim(),
    }))
    .filter((factor) => factor.name !== "" && factor.level !== "");
}

export function FactorsField({
  busy,
  factors,
  onChange,
}: {
  busy: boolean;
  factors: TreatmentFactor[];
  onChange: (factors: TreatmentFactor[]) => void;
}) {
  const set = (index: number, patch: Partial<TreatmentFactor>) => {
    onChange(
      factors.map((factor, at) =>
        at === index ? { ...factor, ...patch } : factor,
      ),
    );
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <Label>Factors</Label>
      {factors.map((factor, index) => (
        <div key={index} className="flex items-end gap-2">
          <TextField
            aria-label={`Factor ${index + 1} name`}
            variant="secondary"
            className="min-w-0 flex-1"
            isDisabled={busy}
            value={factor.name}
            onChange={(name) => set(index, { name })}
          >
            <Input placeholder="6-BA" />
          </TextField>
          <TextField
            aria-label={`Factor ${index + 1} level`}
            variant="secondary"
            className="w-24 shrink-0"
            isDisabled={busy}
            value={factor.level}
            onChange={(level) => set(index, { level })}
          >
            <Input placeholder="1.0" />
          </TextField>
          <TextField
            aria-label={`Factor ${index + 1} unit`}
            variant="secondary"
            className="w-24 shrink-0"
            isDisabled={busy}
            value={factor.unit}
            onChange={(unit) => set(index, { unit })}
          >
            <Input placeholder="mg/L" />
          </TextField>
          <Tooltip delay={0}>
            <Button
              type="button"
              variant="ghost"
              isIconOnly
              aria-label={`Remove factor ${index + 1}`}
              isDisabled={busy}
              onPress={() => onChange(factors.filter((_, at) => at !== index))}
            >
              <CloseIcon />
            </Button>
            <Tooltip.Content>Remove</Tooltip.Content>
          </Tooltip>
        </div>
      ))}
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          isDisabled={busy || factors.length >= 12}
          onPress={() => onChange([...factors, { ...EMPTY_FACTOR }])}
        >
          Add factor
        </Button>
      </div>
    </div>
  );
}
