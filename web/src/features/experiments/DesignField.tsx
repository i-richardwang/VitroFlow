import {
  Button,
  Input,
  Label,
  Separator,
  TextField,
  Tooltip,
} from "@heroui/react";

import type { TreatmentDesignInput } from "../../domain/experiments/schema";
import { replicateCodes } from "../../domain/experiments/naming";
import { m } from "../../paraglide/messages";
import { CloseIcon } from "../../ui/icons";
import { DEFAULT_REPLICATES, ReplicatesField } from "./ReplicatesField";
import { TreatmentDot } from "./TreatmentDot";

export type DesignRow = { name: string; replicates: number };

export const INITIAL_DESIGN: DesignRow[] = [
  { name: "", replicates: DEFAULT_REPLICATES },
];

/** The rows that name a treatment, in the order they will be numbered. */
export function submittedDesign(rows: DesignRow[]): TreatmentDesignInput[] {
  return rows
    .map(({ name, replicates }) => ({ name: name.trim(), replicates }))
    .filter((row) => row.name !== "");
}

/**
 * The design of an experiment: one row per treatment with the number of
 * replicates it is laid out in.
 */
export function DesignField({
  busy,
  rows,
  onChange,
}: {
  busy: boolean;
  rows: DesignRow[];
  onChange: (rows: DesignRow[]) => void;
}) {
  const example = submittedDesign(rows)[0];
  const update = (index: number, row: Partial<DesignRow>) =>
    onChange(
      rows.map((item, at) => (at === index ? { ...item, ...row } : item)),
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label>{m.experiment_design_label()}</Label>
        <p className="text-sm text-muted">
          {m.experiment_design_hint({
            example: example ? replicateCodes(example.name, 1, [])[0]! : "T1-1",
          })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-end gap-2">
            <span className="flex h-10 shrink-0 items-center">
              <TreatmentDot position={index + 1} />
            </span>
            <TextField
              className="min-w-0 flex-1"
              variant="secondary"
              isRequired={index === 0}
              isDisabled={busy}
              aria-label={m.treatment_name_label()}
              value={row.name}
              onChange={(name) => update(index, { name })}
            >
              <Input
                className="w-full"
                placeholder={m.treatment_name_placeholder()}
              />
            </TextField>
            <ReplicatesField
              className="w-32 shrink-0"
              labelled={false}
              busy={busy}
              value={row.replicates}
              onChange={(replicates) => update(index, { replicates })}
            />
            <Tooltip delay={0}>
              <Tooltip.Trigger>
                <Button
                  variant="ghost"
                  isIconOnly
                  isDisabled={busy || rows.length === 1}
                  aria-label={m.experiment_design_remove_treatment({
                    name: row.name || String(index + 1),
                  })}
                  onPress={() => onChange(rows.filter((_, at) => at !== index))}
                >
                  <CloseIcon />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {m.experiment_design_remove_treatment({
                  name: row.name || String(index + 1),
                })}
              </Tooltip.Content>
            </Tooltip>
          </div>
        ))}
      </div>
      <Separator />
      <Button
        className="self-start"
        variant="tertiary"
        size="sm"
        isDisabled={busy || rows.length >= 50}
        onPress={() =>
          onChange([...rows, { name: "", replicates: DEFAULT_REPLICATES }])
        }
      >
        {m.experiment_design_add_treatment()}
      </Button>
    </div>
  );
}
