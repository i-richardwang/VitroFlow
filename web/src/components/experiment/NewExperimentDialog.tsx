import { Button, Form, Modal } from "@heroui/react";
import type { DateValue } from "@internationalized/date";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { currentDay, toDay } from "./DayField";
import {
  DesignField,
  INITIAL_DESIGN,
  submittedDesign,
  type DesignRow,
} from "./DesignField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

export function NewExperimentDialog() {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [open, setOpen] = useState(false);
  const [inoculatedOn, setInoculatedOn] = useState<DateValue | null>(
    currentDay,
  );
  const [design, setDesign] = useState<DesignRow[]>(INITIAL_DESIGN);
  const treatments = submittedDesign(design);
  const close = () => setOpen(false);

  return (
    <>
      <Button
        variant="primary"
        onPress={() => {
          setInoculatedOn(currentDay());
          setDesign(INITIAL_DESIGN);
          setOpen(true);
        }}
      >
        {m.experiment_new()}
      </Button>
      <Modal isOpen={open} onOpenChange={(next) => !next && close()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger aria-label={m.close()} />
              <Modal.Header>
                <Modal.Heading>{m.experiment_new()}</Modal.Heading>
              </Modal.Header>
              <Modal.Body key={open ? "open" : "closed"}>
                <Form
                  id="new-experiment"
                  className="flex w-full min-w-0 flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (inoculatedOn === null || treatments.length === 0) {
                      return;
                    }
                    const form = new FormData(event.currentTarget);
                    void run(
                      () =>
                        startExperiment({
                          data: {
                            ...readExperimentFields(form),
                            inoculatedOn: toDay(inoculatedOn),
                            treatments,
                          },
                        }),
                      m.experiment_not_started(),
                    ).then(async (result) => {
                      if (result.ok) {
                        close();
                        await router.navigate({
                          to: "/experiments/$experiment",
                          params: { experiment: result.value.id },
                        });
                      }
                    });
                  }}
                >
                  <ExperimentFields
                    busy={busy}
                    inoculatedOn={inoculatedOn}
                    onInoculatedOnChange={setInoculatedOn}
                  />
                  <DesignField busy={busy} rows={design} onChange={setDesign} />
                </Form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" isDisabled={busy} onPress={close}>
                  {m.cancel()}
                </Button>
                <Button
                  type="submit"
                  form="new-experiment"
                  variant="primary"
                  isDisabled={busy || treatments.length === 0}
                >
                  {busy ? m.experiment_starting() : m.experiment_start()}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
