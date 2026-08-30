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
import type { TrainingConsole } from "../../server/training-console";
import {
  PARAMETER_FIELDS,
  trainingOverrides,
  trainingOverridesSchema,
} from "../../training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../training/schema";

/** Freezes the reviewed annotations and queues one run with chosen parameters. */
export function TrainDialog({ console }: { console: TrainingConsole }) {
  const { dataset, complete, recipe, training } = console;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState(() =>
    trainingOverrides(console.recipe.parameters),
  );
  const canTrain = complete >= MIN_SNAPSHOT_IMAGES && training.active === null;
  const valid = trainingOverridesSchema.safeParse(overrides).success;

  return (
    <Modal>
      <Button
        variant="primary"
        isDisabled={busy || !canTrain}
        className="shrink-0"
      >
        Train
      </Button>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            {({ close }) => (
              <>
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
                  <Button variant="tertiary" size="sm" onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy || !valid}
                    onPress={() => {
                      setBusy(true);
                      void startTrainingRun({ data: { dataset, overrides } })
                        .then(async () => {
                          close();
                          toast.success("Training run queued");
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Training not started", {
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
                    Train
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
