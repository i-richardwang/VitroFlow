import {
  Alert,
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
        onPress={() => setOpen(true)}
      >
        Train
      </Button>
      <TrainingModal
        console={console}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function TrainingModal({
  console,
  isOpen,
  onClose,
}: {
  console: TrainingConsole;
  isOpen: boolean;
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
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Train a new version</Modal.Heading>
              <Description>
                {recipe.baseModel.reference} · {recipe.runtime.framework}{" "}
                {recipe.runtime.version}
              </Description>
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
                  </NumberField>
                ))}
              </div>
              {training.workerMemoryBytes === null ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>No training worker is online</Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
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
