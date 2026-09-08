import { Button, Dropdown, Label, Separator, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { ObservationImageCell, Unit } from "../../experiments/contracts";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import { removeObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { AddToDatasetDialog } from "../dataset/AddToDatasetDialog";
import { DestructiveActionDialog } from "../DestructiveActionDialog";
import { AssignImagesDialog } from "./AssignImagesDialog";
import { ObservationDialog } from "./ObservationDialog";
import type { ReadableVersion } from "./ReadingFields";

type Action = "images" | "dataset" | "edit" | "delete";

export function ObservationMenu({
  experiment,
  inoculatedOn,
  observation,
  label,
  units,
  images,
  versions,
  datasets,
}: {
  experiment: string;
  inoculatedOn: string;
  observation: ExperimentObservation;
  label: string;
  /** The units that can still be photographed at this observation. */
  units: Unit[];
  /** The images taken at this observation. */
  images: ObservationImageCell[];
  versions: readonly ReadableVersion[];
  /** The datasets training the observation's model. */
  datasets: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);
  const name = observationLabel(observation);
  const assigned = new Set(images.map((image) => image.unit));
  const vacant = units.filter((unit) => !assigned.has(unit.id));

  return (
    <>
      <Dropdown>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={m.observation_actions({ observation: name })}
            onAction={(key) => setOpen(String(key) as Action)}
          >
            {vacant.length > 0 ? (
              <Dropdown.Item
                id="images"
                textValue={m.observation_assign_images()}
              >
                <Label>{m.observation_menu_assign_images()}</Label>
              </Dropdown.Item>
            ) : null}
            {images.length > 0 ? (
              <Dropdown.Item
                id="dataset"
                textValue={m.observation_add_to_dataset()}
              >
                <Label>{m.observation_menu_add_to_dataset()}</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="edit" textValue={m.observation_edit()}>
              <Label>{m.observation_menu_edit()}</Label>
            </Dropdown.Item>
            {!observation.hasRecords ? (
              <>
                <Separator orientation="horizontal" />
                <Dropdown.Item
                  id="delete"
                  textValue={m.observation_delete()}
                  variant="danger"
                >
                  <Label>{m.observation_menu_delete()}</Label>
                </Dropdown.Item>
              </>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {vacant.length > 0 ? (
        <AssignImagesDialog
          experiment={experiment}
          observation={observation}
          units={units}
          assigned={assigned}
          isOpen={open === "images"}
          onClose={close}
        />
      ) : null}

      <AddToDatasetDialog
        isOpen={open === "dataset"}
        images={images.map((image) => ({
          experiment,
          observationImage: image.id,
        }))}
        datasets={datasets}
        heading={m.observation_add_to_dataset()}
        onClose={close}
      />

      <ObservationDialog
        experiment={experiment}
        inoculatedOn={inoculatedOn}
        versions={versions}
        observation={observation}
        isOpen={open === "edit"}
        onClose={close}
      />

      <DestructiveActionDialog
        isOpen={open === "delete"}
        onOpenChange={(isOpen) => setOpen(isOpen ? "delete" : null)}
        title={m.observation_delete_title({ observation: name })}
        confirmLabel={m.observation_delete()}
        onConfirm={async () => {
          await removeObservation({
            data: { experiment, observation: observation.id },
          });
          toast.success(m.observation_deleted({ observation: name }));
          await router.invalidate();
        }}
      />
    </>
  );
}
