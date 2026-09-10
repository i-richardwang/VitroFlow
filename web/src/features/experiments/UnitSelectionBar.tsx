import { ActionBar } from "@heroui-pro/react/action-bar";
import { Button, Chip, Separator, Tooltip } from "@heroui/react";
import { useEffect, useState } from "react";

import type { Unit } from "../../domain/experiments/contracts";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";
import { CloseIcon, EditIcon, EventIcon } from "../../ui/icons";
import { MoveUnitsDialog } from "./MoveUnitsDialog";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";

/** Bulk actions for the units selected on the experiment grid. */
export function UnitSelectionBar({
  experiment,
  units,
  treatments,
  observations,
  onClear,
}: {
  experiment: string;
  units: Unit[];
  treatments: Treatment[];
  observations: ExperimentObservation[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState<"record" | "move" | null>(null);

  useEffect(() => {
    if (units.length === 0) setOpen(null);
  }, [units.length]);

  return (
    <>
      <ActionBar
        aria-label={m.experiment_selection()}
        isOpen={units.length > 0}
      >
        <ActionBar.Prefix>
          <Chip size="sm" className="tabular-nums">
            {units.length}
          </Chip>
        </ActionBar.Prefix>
        <Separator />
        <ActionBar.Content>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={observations.length === 0}
            onPress={() => setOpen("record")}
          >
            <EventIcon />
            <span className="action-bar__label">
              {m.culture_event_record_action()}
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={treatments.length < 2}
            onPress={() => setOpen("move")}
          >
            <EditIcon />
            <span className="action-bar__label">
              {m.experiment_move_units()}
            </span>
          </Button>
        </ActionBar.Content>
        <Separator />
        <ActionBar.Suffix>
          <Tooltip delay={0}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={m.experiment_selection_clear()}
              onPress={onClear}
            >
              <CloseIcon />
            </Button>
            <Tooltip.Content>{m.experiment_selection_clear()}</Tooltip.Content>
          </Tooltip>
        </ActionBar.Suffix>
      </ActionBar>
      <RecordCultureEventDialog
        experiment={experiment}
        units={units}
        observations={observations}
        isOpen={open === "record"}
        onClose={() => setOpen(null)}
      />
      <MoveUnitsDialog
        experiment={experiment}
        units={units}
        treatments={treatments}
        isOpen={open === "move"}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
