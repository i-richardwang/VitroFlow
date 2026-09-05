import {
  Button,
  FieldError,
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
import { m } from "../../paraglide/messages";

const NEW_DATASET = "\0new";

export function AddToDatasetButton({
  images,
  datasets,
  heading = m.dataset_add_heading(),
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
  heading = m.dataset_add_heading(),
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
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{heading}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="add-to-dataset"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const dataset =
                    choice === NEW_DATASET
                      ? String(form.get("name") ?? "")
                      : choice;
                  void run(
                    () => addToDataset({ data: { dataset, images } }),
                    m.dataset_add_nothing_added(),
                  ).then(async (result) => {
                    if (result.ok) {
                      const { added, existing } = result.value;
                      onClose();
                      toast.success(
                        existing > 0
                          ? m.dataset_add_result_existing({
                              added,
                              dataset,
                              existing,
                            })
                          : m.dataset_add_result({ added, dataset }),
                      );
                      await router.invalidate();
                    }
                  });
                }}
              >
                <Select
                  variant="secondary"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={choice}
                  onSelectionChange={(key) => {
                    if (key != null) setChoice(String(key));
                  }}
                >
                  <Label>{m.dataset_add_dataset_label()}</Label>
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
                          <span className="font-mono">{dataset}</span>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                      <ListBox.Item
                        id={NEW_DATASET}
                        textValue={m.dataset_add_new()}
                      >
                        {m.dataset_add_new()}
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
                    <Label>{m.dataset_add_name_label()}</Label>
                    <Input
                      className="w-full"
                      placeholder={m.dataset_add_name_placeholder()}
                    />
                    <FieldError />
                  </TextField>
                ) : null}
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="add-to-dataset"
                variant="primary"
                isDisabled={busy}
              >
                {busy ? m.dataset_add_submitting() : m.dataset_add_submit()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
