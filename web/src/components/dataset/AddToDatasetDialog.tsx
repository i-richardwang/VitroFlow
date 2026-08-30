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

import { DATASET_NAME_PATTERN } from "../../datasets/schema";
import type { PhotoRef } from "../../experiments/schema";
import { addToDataset } from "../../functions/datasets";

const NEW_DATASET = "\0new";

/**
 * Puts experiment photographs into a training set for the model they were
 * read with. An existing dataset of that model can be chosen; a new name
 * creates one.
 */
export function AddToDatasetDialog({
  photos,
  datasets,
  label = "Add to dataset",
}: {
  photos: PhotoRef[];
  datasets: string[];
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(datasets[0] ?? NEW_DATASET);

  return (
    <Modal>
      <Button variant="secondary" isDisabled={photos.length === 0}>
        {label}
      </Button>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>{label}</Modal.Heading>
                  <Description>
                    Reviewed boxes for this model come with the photographs.
                  </Description>
                </Modal.Header>
                <Modal.Body>
                  <Form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const dataset =
                        choice === NEW_DATASET
                          ? String(form.get("name") ?? "")
                          : choice;
                      setBusy(true);
                      void addToDataset({
                        data: { dataset, photos },
                      })
                        .then(async ({ added, existing }) => {
                          close();
                          toast.success(
                            existing > 0
                              ? `${added} added to ${dataset}; ${existing} already there`
                              : `${added} added to ${dataset}`,
                          );
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Nothing was added", {
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
                        <Select
                          variant="secondary"
                          fullWidth
                          isDisabled={busy}
                          selectedKey={choice}
                          onSelectionChange={(key) => {
                            if (key != null) setChoice(String(key));
                          }}
                        >
                          <Label>Dataset</Label>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {datasets.map((dataset) => (
                                <ListBox.Item
                                  key={dataset}
                                  id={dataset}
                                  textValue={dataset}
                                >
                                  <Label className="font-mono">{dataset}</Label>
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                              <ListBox.Item
                                id={NEW_DATASET}
                                textValue="New dataset"
                              >
                                <Label>New dataset</Label>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        {choice === NEW_DATASET ? (
                          <TextField
                            variant="secondary"
                            fullWidth
                            isRequired
                            isDisabled={busy}
                            name="name"
                            pattern={DATASET_NAME_PATTERN}
                          >
                            <Label>Name</Label>
                            <Input placeholder="seeds-2026-09" />
                            <Description>
                              Letters, numbers, dots, dashes, and underscores.
                            </Description>
                            <FieldError />
                          </TextField>
                        ) : null}
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
                          {busy ? "Adding…" : "Add"}
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
