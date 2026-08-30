import {
  Button,
  Description,
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

import { versionSlug, type ModelVersion } from "../../models/schema";
import { startExperiment } from "../../server/experiment-views";

/** Starts an experiment that counts with one trained version. */
export function NewExperimentDialog({
  versions,
}: {
  versions: ModelVersion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Modal>
      <Button variant="primary" isDisabled={versions.length === 0}>
        New experiment
      </Button>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>New experiment</Modal.Heading>
                  <Description>
                    Every count in the experiment comes from the version chosen
                    here.
                  </Description>
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
                    <Fieldset>
                      <Fieldset.Group>
                        <TextField
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
                          fullWidth
                          isRequired
                          isDisabled={busy}
                          name="version"
                          placeholder="Choose a trained version"
                        >
                          <Label>Model version</Label>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {versions.map((version) => (
                                <ListBox.Item
                                  key={version.id}
                                  id={version.id}
                                  textValue={version.id}
                                >
                                  <Label className="font-mono">
                                    {version.modelId} · {versionSlug(version)}
                                  </Label>
                                  <Description>{version.name}</Description>
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                          <FieldError />
                        </Select>
                      </Fieldset.Group>
                      <Fieldset.Actions>
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
