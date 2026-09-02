import {
  Button,
  FieldError,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
} from "@heroui/react";
import type { DateValue } from "@internationalized/date";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type { Model, ModelVersion } from "../../models/schema";
import { currentDay, toDay } from "./DayField";
import { ExperimentFields, readExperimentFields } from "./ExperimentFields";

export function NewExperimentDialog({
  versions,
}: {
  versions: Array<{ model: Model; version: ModelVersion }>;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [open, setOpen] = useState(false);
  const [inoculatedOn, setInoculatedOn] = useState<DateValue | null>(
    currentDay,
  );
  const close = () => setOpen(false);

  return (
    <>
      <Button
        variant="primary"
        onPress={() => {
          setInoculatedOn(currentDay());
          setOpen(true);
        }}
      >
        New experiment
      </Button>
      <Modal isOpen={open} onOpenChange={(next) => !next && close()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>New experiment</Modal.Heading>
              </Modal.Header>
              <Modal.Body key={open ? "open" : "closed"}>
                <Form
                  id="new-experiment"
                  className="flex w-full min-w-0 flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (inoculatedOn === null) return;
                    const form = new FormData(event.currentTarget);
                    void run(
                      () =>
                        startExperiment({
                          data: {
                            ...readExperimentFields(form),
                            inoculatedOn: toDay(inoculatedOn),
                            modelVersionId: String(form.get("version") ?? ""),
                          },
                        }),
                      "Experiment not started",
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
                  <Select
                    variant="secondary"
                    fullWidth
                    isRequired
                    isDisabled={busy}
                    name="version"
                    defaultSelectedKey={versions[0]?.version.id}
                  >
                    <Label>Version</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {versions.map(({ version }) => (
                          <ListBox.Item
                            key={version.id}
                            id={version.id}
                            textValue={version.name}
                          >
                            {version.name}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                    <FieldError />
                  </Select>
                </Form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" isDisabled={busy} onPress={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="new-experiment"
                  variant="primary"
                  isDisabled={busy}
                >
                  {busy ? "Starting…" : "Start"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
