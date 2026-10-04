import { useRouter } from "@tanstack/react-router";
import {
  CircleMinus,
  ClipboardPen,
  ImageMinus,
  ImageUp,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type {
  ExperimentObservationImage,
  Unit,
} from "../../domain/experiments/contracts";
import type {
  ExperimentObservation,
  Treatment,
} from "../../domain/experiments/schema";
import {
  removeCultureEvent,
  removeUnit,
  unassignObservationImage,
} from "../../functions/experiments";
import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { FormDialog } from "../../ui/FormDialog";
import {
  useAsyncAction,
  type AsyncAction,
} from "../../ui/hooks/useAsyncAction";
import type { DropdownItem } from "../../ui/kit/DropdownMenu";
import { Form } from "../../ui/kit/Form";
import { Select } from "../../ui/kit/Select";
import { toast } from "../../ui/kit/Toast";
import { cultureEventLabel, observationLabel } from "./labels";
import { RecordCultureEventDialog } from "./RecordCultureEventDialog";
import { ReplaceObservationImageDialog } from "./ReplaceObservationImageDialog";
import { UnitDialog } from "./UnitDialog";

type Action = "replace" | "edit" | "record" | "remove-event";

const REMOVE_EVENT_FORM = "remove-culture-event";

export function UnitMenu({
  experiment,
  unit,
  treatments,
  observations,
  canRemove,
  image,
}: {
  experiment: string;
  unit: Unit;
  treatments: Treatment[];
  observations: ExperimentObservation[];
  canRemove: boolean;
  image: ExperimentObservationImage | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const close = () => setOpen(null);

  const items: DropdownItem[] = [];
  if (image) {
    items.push({
      key: "replace",
      icon: ImageUp,
      label: m.unit_menu_replace(),
      onClick: () => setOpen("replace"),
    });
  }
  items.push({
    key: "edit",
    icon: Pencil,
    label: m.unit_menu_edit(),
    onClick: () => setOpen("edit"),
  });
  if (observations.length > 0) {
    items.push({
      key: "record",
      icon: ClipboardPen,
      label: m.culture_event_menu_record(),
      onClick: () => setOpen("record"),
    });
  }
  if (unit.events.length > 0) {
    items.push({
      key: "remove-event",
      icon: CircleMinus,
      label: m.culture_event_menu_remove(),
      onClick: () => setOpen("remove-event"),
    });
  }
  if (image || canRemove) items.push({ type: "divider" });
  if (image) {
    items.push({
      key: "unassign",
      icon: ImageMinus,
      danger: true,
      label: m.unit_menu_unassign(),
      onClick: () =>
        confirmDestructive({
          title: m.unit_unassign_title({
            file: image.review.filename,
            code: unit.code,
          }),
          content: m.unit_unassign_note(),
          confirmLabel: m.unit_unassign(),
          onConfirm: async () => {
            await unassignObservationImage({ data: image.ref });
            toast.success(m.unit_image_unassigned());
            await router.navigate({
              to: "/experiments/$experiment",
              params: { experiment: image.ref.experiment },
            });
          },
        }),
    });
  }
  if (canRemove) {
    items.push({
      key: "delete",
      icon: Trash2,
      danger: true,
      label: m.unit_menu_delete(),
      onClick: () =>
        confirmDestructive({
          title: m.unit_delete_title({ code: unit.code }),
          confirmLabel: m.unit_delete(),
          onConfirm: async () => {
            await removeUnit({ data: { experiment, unit: unit.id } });
            toast.success(m.unit_deleted({ code: unit.code }));
            await router.invalidate();
          },
        }),
    });
  }

  return (
    <>
      <PageMenu label={m.unit_actions({ code: unit.code })} items={items} />

      <UnitDialog
        experiment={experiment}
        unit={unit}
        treatments={treatments}
        open={open === "edit"}
        onClose={close}
      />

      <RecordCultureEventDialog
        experiment={experiment}
        units={[unit]}
        observations={observations}
        open={open === "record"}
        onClose={close}
      />

      <RemoveCultureEventDialog
        experiment={experiment}
        unit={unit}
        observations={observations}
        open={open === "remove-event"}
        onClose={close}
      />

      {image ? (
        <ReplaceObservationImageDialog
          image={image}
          open={open === "replace"}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function RemoveCultureEventDialog({
  experiment,
  unit,
  observations,
  open,
  onClose,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.culture_event_remove()}
      okText={m.culture_event_remove_action()}
      formId={REMOVE_EVENT_FORM}
      busy={action.busy}
      danger
    >
      <RemoveCultureEventForm
        experiment={experiment}
        unit={unit}
        observations={observations}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

/** Proposes the unit's latest status. */
function RemoveCultureEventForm({
  experiment,
  unit,
  observations,
  action,
  onDone,
}: {
  experiment: string;
  unit: Unit;
  observations: ExperimentObservation[];
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const { events } = unit;
  const [event, setEvent] = useState(events.at(-1)?.id ?? "");
  const describe = (item: (typeof events)[number]) => {
    const observation = observations.find(
      (entry) => entry.id === item.observation,
    );
    return observation
      ? m.culture_event_at({
          event: cultureEventLabel(item.type),
          observation: observationLabel(observation),
        })
      : cultureEventLabel(item.type);
  };

  return (
    <Form
      id={REMOVE_EVENT_FORM}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        const removed = events.find((item) => item.id === event);
        if (!removed) return;
        void action
          .run(
            () => removeCultureEvent({ data: { experiment, event } }),
            m.culture_event_not_removed(),
          )
          .then(async (result) => {
            if (!result.ok) return;
            toast.success(
              m.culture_event_removed({ event: describe(removed) }),
            );
            onDone();
            await router.invalidate();
          });
      }}
    >
      <Form.Field label={m.culture_event_label()} required>
        <Select
          disabled={action.busy}
          options={events.map((item) => ({
            label: describe(item),
            value: item.id,
          }))}
          value={event}
          onChange={setEvent}
        />
      </Form.Field>
    </Form>
  );
}
