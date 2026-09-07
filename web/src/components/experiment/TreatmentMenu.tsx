import { Button, Dropdown, Label } from "@heroui/react";
import { useState } from "react";

import type { Treatment } from "../../experiments/schema";
import { m } from "../../paraglide/messages";
import { MoreIcon } from "../icons";
import { ReplicatesDialog, TreatmentDialog } from "./TreatmentDialog";

type Action = "edit" | "replicates";

/** What can be done to one treatment of the design. */
export function TreatmentMenu({
  experiment,
  treatment,
}: {
  experiment: string;
  treatment: Treatment;
}) {
  const [open, setOpen] = useState<Action | null>(null);
  const label = m.treatment_actions({ name: treatment.name });
  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly size="sm" aria-label={label}>
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={label}
            onAction={(key) => setOpen(key as Action)}
          >
            <Dropdown.Item
              id="replicates"
              textValue={m.treatment_add_replicates({ name: treatment.name })}
            >
              <Label>{m.treatment_menu_add_replicates()}</Label>
            </Dropdown.Item>
            <Dropdown.Item
              id="edit"
              textValue={m.treatment_edit({ name: treatment.name })}
            >
              <Label>{m.treatment_menu_edit({ name: treatment.name })}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <TreatmentDialog
        experiment={experiment}
        treatment={treatment}
        isOpen={open === "edit"}
        onClose={() => setOpen(null)}
      />
      <ReplicatesDialog
        experiment={experiment}
        treatment={treatment}
        isOpen={open === "replicates"}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
