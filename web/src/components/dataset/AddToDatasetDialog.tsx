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
import type { ObservationImageRef } from "../../experiments/schema";
import { addToDataset } from "../../functions/datasets";
import { useAsyncAction } from "../../hooks/useAsyncAction";

const NEW_DATASET = "\0new";

export function AddToDatasetButton({
  images,
  datasets,
  heading = "Add to dataset",
}: {
  images: ObservationImageRef[];
  datasets: string[];
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        isDisabled={images.length === 0}
        onPress={() => setOpen(true)}
      >
        {heading}
      </Button>
      <AddToDatasetDialog
        isOpen={open}
        images={images}
        datasets={datasets}
        heading={heading}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function AddToDatasetDialog({
  isOpen,
  images,
  datasets,
  heading = "Add to dataset",
  onClose,
}: {
  isOpen: boolean;
  images: ObservationImageRef[];
  datasets: string[];
  heading?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [choice, setChoice] = useState(datasets[0] ?? NEW_DATASET);

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{heading}</Modal.Heading>
              <Description>
                Reviewed annotations for this model are included with the
                images.
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
                  void run(
                    () => addToDataset({ data: { dataset, images } }),
                    "Nothing was added",
                  ).then(async (result) => {
                    if (result.ok) {
                      const { added, existing } = result.value;
                      onClose();
                      toast.success(
                        existing > 0
                          ? `${added} added to ${dataset}; ${existing} already there`
                          : `${added} added to ${dataset}`,
                      );
                      await router.invalidate();
                    }
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
                    <Button variant="tertiary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" isDisabled={busy}>
                      {busy ? "Adding…" : "Add"}
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
