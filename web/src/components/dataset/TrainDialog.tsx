import { AlertDialog, Button, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { startTrainingRun } from "../../server/models";
import type { TrainingOverview } from "../../server/overview";
import { MIN_SNAPSHOT_IMAGES } from "../../training/schema";

/** Freezes the reviewed annotations and queues one training run. */
export function TrainDialog({
  dataset,
  complete,
  training,
}: {
  dataset: string;
  complete: number;
  training: TrainingOverview;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canTrain = complete >= MIN_SNAPSHOT_IMAGES && training.active === null;

  return (
    <AlertDialog>
      <Button
        variant="primary"
        size="sm"
        isDisabled={busy || !canTrain}
        className="shrink-0"
      >
        Train
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            {({ close }) => (
              <>
                <AlertDialog.Header>
                  <AlertDialog.Heading>Train a new version?</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body className="flex flex-col gap-3">
                  <p>
                    The {complete} complete annotations in {dataset} are frozen
                    into a snapshot and queued for the next training worker.
                    The result is published as a candidate version and does not
                    change which version prelabels this dataset.
                  </p>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                    <dt className="text-muted">Base model</dt>
                    <dd>{training.recipe.baseModel.reference}</dd>
                    <dt className="text-muted">Configuration</dt>
                    <dd>{training.recipe.configuration.name}</dd>
                    <dt className="text-muted">Runtime</dt>
                    <dd>
                      {training.recipe.runtime.framework}{" "}
                      {training.recipe.runtime.version}
                    </dd>
                  </dl>
                  {training.workersOnline === 0 && (
                    <p className="text-warning">
                      No training worker is online; the run waits in the queue.
                    </p>
                  )}
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button variant="tertiary" size="sm" onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => {
                      setBusy(true);
                      void startTrainingRun({ data: { dataset } })
                        .then(async () => {
                          close();
                          toast.success("Training run queued");
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Training not started", {
                            description:
                              cause instanceof Error ? cause.message : String(cause),
                          });
                        })
                        .finally(() => {
                          setBusy(false);
                        });
                    }}
                  >
                    Train
                  </Button>
                </AlertDialog.Footer>
              </>
            )}
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
