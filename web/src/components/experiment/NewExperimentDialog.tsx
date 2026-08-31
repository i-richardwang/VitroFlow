import {
  Button,
  FieldError,
  Fieldset,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startExperiment } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type { Model, ModelVersion } from "../../models/schema";
import { ExperimentFields } from "./ExperimentFields";

export function NewExperimentDialog({
  versions,
}: {
  versions: Array<{ model: Model; version: ModelVersion }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        New experiment
      </Button>
      {open ? (
        <NewExperimentModal
          versions={versions}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function NewExperimentModal({
  versions,
  onClose,
}: {
  versions: Array<{ model: Model; version: ModelVersion }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New experiment</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      startExperiment({
                        data: {
                          name: String(form.get("name") ?? ""),
                          description: String(form.get("description") ?? ""),
                          modelVersionId: String(form.get("version") ?? ""),
                        },
                      }),
                    "Experiment not started",
                  ).then(async (result) => {
                    if (result.ok) {
                      onClose();
                      await router.navigate({
                        to: "/experiments/$experiment",
                        params: { experiment: result.value.id },
                      });
                    }
                  });
                }}
              >
                <Fieldset className="w-full">
                  <Fieldset.Group>
                    <ExperimentFields busy={busy} />
                    <Select
                      variant="secondary"
                      fullWidth
                      isRequired
                      isDisabled={busy}
                      name="version"
                      defaultSelectedKey={versions[0]?.version.id}
                      placeholder="Choose a version"
                    >
                      <Label>Version</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {versions.map(({ model, version }) => (
                            <ListBox.Item
                              key={version.id}
                              id={version.id}
                              textValue={`${model.name} ${version.name}`}
                            >
                              <span className="flex min-w-0 flex-col">
                                <Label>{model.name}</Label>
                                <span className="truncate text-xs text-muted">
                                  {version.name}
                                </span>
                              </span>
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                      <FieldError />
                    </Select>
                  </Fieldset.Group>
                  <Fieldset.Actions>
                    <Button variant="tertiary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Starting…" : "Start"}
                    </Button>
                  </Fieldset.Actions>
                </Fieldset>
              </Form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
