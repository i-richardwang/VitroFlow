import type { CalendarDate } from "@internationalized/date";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startExperiment } from "../../functions/experiments";
import { DialogSession, FormDialog } from "../../ui/FormDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { m } from "../../paraglide/messages";
import { currentDay, toDay } from "./DayField";
import {
  DesignField,
  INITIAL_DESIGN,
  submittedDesign,
  type DesignRow,
} from "./DesignField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

const FORM_ID = "new-experiment";

interface NewExperimentDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Starts an experiment from its notebook page and its design, then opens it. */
export function NewExperimentDialog(props: NewExperimentDialogProps) {
  return (
    <DialogSession open={props.open}>
      {(afterClose) => (
        <NewExperimentSession {...props} afterClose={afterClose} />
      )}
    </DialogSession>
  );
}

function NewExperimentSession({
  open,
  onClose,
  afterClose,
}: NewExperimentDialogProps & { afterClose: () => void }) {
  const router = useRouter();
  const action = useAsyncAction();
  const [inoculatedOn, setInoculatedOn] = useState<CalendarDate>(currentDay);
  const [design, setDesign] = useState<DesignRow[]>(INITIAL_DESIGN);
  const treatments = submittedDesign(design);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      afterClose={afterClose}
      title={m.experiment_new()}
      okText={m.experiment_start()}
      formId={FORM_ID}
      busy={action.busy}
      okDisabled={treatments.length === 0}
      width="wide"
    >
      <Form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          if (treatments.length === 0) return;
          const form = new FormData(event.currentTarget);
          void action
            .run(
              () =>
                startExperiment({
                  data: {
                    ...readExperimentFields(form),
                    inoculatedOn: toDay(inoculatedOn),
                    treatments,
                  },
                }),
              m.experiment_not_started(),
            )
            .then(async (result) => {
              if (!result.ok) return;
              onClose();
              await router.navigate({
                to: "/experiments/$experiment",
                params: { experiment: result.value.id },
              });
            });
        }}
      >
        <ExperimentFields
          disabled={action.busy}
          inoculatedOn={inoculatedOn}
          onInoculatedOnChange={setInoculatedOn}
        />
        <DesignField
          disabled={action.busy}
          rows={design}
          onChange={setDesign}
        />
      </Form>
    </FormDialog>
  );
}
