import { useRouter } from "@tanstack/react-router";
import { ChevronDown, FolderPlus, Images, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type {
  ObservationImageCell,
  Unit,
} from "../../domain/experiments/contracts";
import type { PlacedPhoto } from "../../domain/experiments/photos";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import type { Model } from "../../domain/models/schema";
import { removeObservation } from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { Button } from "../../ui/kit/Button";
import { DropdownMenu, type DropdownItem } from "../../ui/kit/DropdownMenu";
import { toast } from "../../ui/kit/Toast";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { AssignImagesDialog } from "./AssignImagesDialog";
import { observationLabel } from "./labels";
import { ObservationDialog } from "./ObservationDialog";

type Action = "images" | "dataset" | "edit";

/** An observation day's column heading, opening what can be done to that day. */
export function ObservationMenu({
  experiment,
  inoculatedOn,
  observation,
  label,
  units,
  images,
  placed,
  models,
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
  /** The photographs the experiment holds across all its observations. */
  placed: readonly PlacedPhoto[];
  models: readonly Model[];
  /** The datasets training the observation's model. */
  datasets: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);
  const name = observationLabel(observation);
  const assigned = new Set(images.map((image) => image.unit));
  const vacant = units.filter((unit) => !assigned.has(unit.id));

  const items: DropdownItem[] = [];
  if (vacant.length > 0) {
    items.push({
      key: "images",
      icon: Images,
      label: m.observation_menu_assign_images(),
      onClick: () => setOpen("images"),
    });
  }
  if (images.length > 0) {
    items.push({
      key: "dataset",
      icon: FolderPlus,
      label: m.observation_menu_add_to_dataset(),
      onClick: () => setOpen("dataset"),
    });
  }
  items.push({
    key: "edit",
    icon: Pencil,
    label: m.observation_menu_edit(),
    onClick: () => setOpen("edit"),
  });
  if (!observation.hasRecords) {
    items.push(
      { type: "divider" },
      {
        key: "delete",
        icon: Trash2,
        danger: true,
        label: m.observation_menu_delete(),
        onClick: () =>
          confirmDestructive({
            title: m.observation_delete_title({ observation: name }),
            confirmLabel: m.observation_delete(),
            onConfirm: async () => {
              await removeObservation({
                data: { experiment, observation: observation.id },
              });
              toast.success(m.observation_deleted({ observation: name }));
              await router.invalidate();
            },
          }),
      },
    );
  }

  return (
    <>
      <DropdownMenu items={items} placement="bottomLeft">
        <Button
          type="text"
          size="small"
          outdent
          icon={ChevronDown}
          iconPosition="end"
          aria-label={m.observation_actions({ observation: label })}
        >
          {label}
        </Button>
      </DropdownMenu>

      <AssignImagesDialog
        experiment={experiment}
        observation={observation}
        units={units}
        assigned={assigned}
        placed={placed}
        open={open === "images"}
        onClose={close}
      />

      <AddToDatasetDialog
        open={open === "dataset"}
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
        models={models}
        observation={observation}
        open={open === "edit"}
        onClose={close}
      />
    </>
  );
}
