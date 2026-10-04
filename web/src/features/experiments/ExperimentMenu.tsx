import { useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Experiment } from "../../domain/experiments/schema";
import { editExperiment, removeExperiment } from "../../functions/experiments";
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
import { toast } from "../../ui/kit/Toast";
import { fromDay, toDay } from "./DayField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

const EDIT_FORM = "edit-experiment";

export function ExperimentMenu({
  experiment,
  hasRecords,
  onNewTreatment,
}: {
  experiment: Experiment;
  hasRecords: boolean;
  onNewTreatment: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const items: DropdownItem[] = [
    {
      key: "treatment",
      icon: Plus,
      label: m.treatment_menu_new(),
      onClick: onNewTreatment,
    },
    { type: "divider" },
    {
      key: "edit",
      icon: Pencil,
      label: m.experiment_menu_edit(),
      onClick: () => setEditing(true),
    },
  ];
  if (!hasRecords) {
    items.push({
      key: "delete",
      icon: Trash2,
      danger: true,
      label: m.experiment_menu_delete(),
      onClick: () =>
        confirmDestructive({
          title: m.experiment_delete_title({ name: experiment.name }),
          confirmLabel: m.experiment_delete(),
          onConfirm: async () => {
            await removeExperiment({ data: { experiment: experiment.id } });
            toast.success(m.experiment_deleted({ name: experiment.name }));
            await router.navigate({ to: "/experiments" });
          },
        }),
    });
  }

  return (
    <>
      <PageMenu
        label={m.experiment_actions({ name: experiment.name })}
        items={items}
      />
      <EditExperimentDialog
        experiment={experiment}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

function EditExperimentDialog({
  experiment,
  open,
  onClose,
}: {
  experiment: Experiment;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.experiment_edit_heading()}
      okText={m.experiment_action_save()}
      formId={EDIT_FORM}
      busy={action.busy}
      width="wide"
    >
      <EditExperimentForm
        experiment={experiment}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function EditExperimentForm({
  experiment,
  action,
  onDone,
}: {
  experiment: Experiment;
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [inoculatedOn, setInoculatedOn] = useState(() =>
    fromDay(experiment.inoculatedOn),
  );
  return (
    <Form
      id={EDIT_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        const fields = readExperimentFields(new FormData(event.currentTarget));
        void action
          .run(
            () =>
              editExperiment({
                data: {
                  experiment: experiment.id,
                  ...fields,
                  inoculatedOn: toDay(inoculatedOn),
                },
              }),
            m.experiment_not_saved(),
          )
          .then(async (result) => {
            if (!result.ok) return;
            onDone();
            await router.invalidate();
          });
      }}
    >
      <ExperimentFields
        disabled={action.busy}
        defaults={experiment}
        inoculatedOn={inoculatedOn}
        onInoculatedOnChange={setInoculatedOn}
      />
    </Form>
  );
}
