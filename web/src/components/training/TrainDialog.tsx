import {
  Button,
  Description,
  Label,
  Modal,
  NumberField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../functions/training";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type { TrainingConsole } from "../../training/read-model";
import {
  PARAMETER_FIELDS,
  trainingOverrides,
  trainingOverridesSchema,
} from "../../training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../training/schema";

export function TrainDialog({ console }: { console: TrainingConsole }) {
  const { complete, training } = console;
  const [open, setOpen] = useState(false);
  const canTrain = complete >= MIN_SNAPSHOT_IMAGES && training.active === null;

  return (
    <>
      <Button
        variant="primary"
        isDisabled={!canTrain}
        className="shrink-0"
        onPress={() => setOpen(true)}
      >
        Train
      </Button>
      {open ? (
        <TrainingModal console={console} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function TrainingModal({
  console,
  onClose,
}: {
  console: TrainingConsole;
  onClose: () => void;
}) {
  const { dataset, recipe, training } = console;
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [overrides, setOverrides] = useState(() =>
    trainingOverrides(console.recipe.parameters),
  );
  const valid = trainingOverridesSchema.safeParse(overrides).success;

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Train a new version</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {PARAMETER_FIELDS.map((field) => (
                  <NumberField
                    key={field.key}
                    variant="secondary"
                    value={overrides[field.key]}
                    minValue={field.min}
                    maxValue={field.max}
                    step={field.step}
                    formatOptions={{ maximumFractionDigits: 5 }}
                    onChange={(value) =>
                      setOverrides((current) => ({
                        ...current,
                        [field.key]: value,
                      }))
                    }
                  >
                    <Label>{field.label}</Label>
                    <NumberField.Group>
                      <NumberField.DecrementButton />
                      <NumberField.Input />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                    <Description>{field.description}</Description>
                  </NumberField>
                ))}
              </div>
              <p className="text-xs text-muted">
                {recipe.baseModel.reference} · {recipe.runtime.framework}{" "}
                {recipe.runtime.version}
              </p>
              {training.workerMemoryBytes === null ? (
                <p className="text-sm text-warning">
                  No training worker is online; the run waits in the queue.
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                isDisabled={busy || !valid}
                onPress={() => {
                  void run(
                    () => startTrainingRun({ data: { dataset, overrides } }),
                    "Training not started",
                  ).then(async (result) => {
                    if (result.ok) {
                      onClose();
                      toast.success("Training run queued");
                      await router.invalidate();
                    }
                  });
                }}
              >
                Train
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
