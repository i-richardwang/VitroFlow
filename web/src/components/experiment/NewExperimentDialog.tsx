import {
  Button,
  FieldError,
  Fieldset,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Model, ModelVersion } from "../../models/schema";
import { startExperiment } from "../../functions/experiments";

/**
 * Starts an experiment that reads with one version. Versions are listed
 * newest first, so the latest trained one is preselected and the baseline
 * is the choice only until training has produced something better.
 */
export function NewExperimentDialog({
  versions,
}: {
  versions: Array<{ model: Model; version: ModelVersion }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Modal>
      <Button variant="primary">New experiment</Button>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>New experiment</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <Form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      setBusy(true);
                      void startExperiment({
                        data: {
                          name: String(form.get("name") ?? ""),
                          modelVersionId: String(form.get("version") ?? ""),
                        },
                      })
                        .then(async (experiment) => {
                          close();
                          await router.navigate({
                            to: "/experiments/$experiment",
                            params: { experiment: experiment.id },
                          });
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Experiment not started", {
                            description:
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                          });
                        })
                        .finally(() => {
                          setBusy(false);
                        });
                    }}
                  >
                    <Fieldset className="w-full">
                      <Fieldset.Group>
                        <TextField
                          variant="secondary"
                          fullWidth
                          isRequired
                          isDisabled={busy}
                          name="name"
                        >
                          <Label>Name</Label>
                          <Input placeholder="September germination study" />
                          <FieldError />
                        </TextField>
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
                        <Button variant="tertiary" onPress={close}>
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          isDisabled={busy}
                        >
                          {busy ? "Starting…" : "Start"}
                        </Button>
                      </Fieldset.Actions>
                    </Fieldset>
                  </Form>
                </Modal.Body>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
