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

import { startTrainingRun } from "../../server/models";
import type { TrainingConsole } from "../../server/training-console";
import {
  PARAMETER_FIELDS,
  tunableParametersSchema,
  type TunableParameters,
} from "../../training/parameters";
import { MIN_SNAPSHOT_IMAGES } from "../../training/schema";

function tunable(console: TrainingConsole): TunableParameters {
  return tunableParametersSchema.parse(console.recipe.parameters);
}

/** Freezes the reviewed annotations and queues one run with chosen parameters. */
export function TrainDialog({ console }: { console: TrainingConsole }) {
  const { dataset, complete, recipe, training } = console;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [parameters, setParameters] = useState(() => tunable(console));
  const canTrain = complete >= MIN_SNAPSHOT_IMAGES && training.active === null;
  const valid = tunableParametersSchema.safeParse(parameters).success;

  return (
    <Modal>
      <Button
        variant="primary"
        size="sm"
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
                <Modal.Header>
                  <Modal.Heading>Train a new version</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-5">
                  <p className="text-sm text-muted">
                    The {complete} complete annotations in {dataset} are frozen
                    into a snapshot and queued for the next training worker. The
                    result is published as a candidate version and does not
                    change which version prelabels this dataset.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {PARAMETER_FIELDS.map((field) => (
                      <NumberField
                        key={field.key}
                        value={parameters[field.key]}
                        minValue={field.min}
                        maxValue={field.max}
                        step={field.step}
                        formatOptions={{ maximumFractionDigits: 5 }}
                        onChange={(value) =>
                          setParameters((current) => ({
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
                  <p className="font-mono text-xs text-muted">
                    {recipe.baseModel.reference} · {recipe.runtime.framework}{" "}
                    {recipe.runtime.version} · {recipe.parameters.optimizer},
                    mosaic {recipe.parameters.mosaic}, max_det{" "}
                    {recipe.parameters.max_det}
                  </p>
                  {training.workersOnline === 0 && (
                    <p className="text-sm text-warning">
                      No training worker is online; the run waits in the queue.
                    </p>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onPress={() => setParameters(tunable(console))}
                  >
                    Reset
                  </Button>
                  <Button variant="tertiary" size="sm" onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy || !valid}
                    onPress={() => {
                      setBusy(true);
                      void startTrainingRun({ data: { dataset, parameters } })
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
