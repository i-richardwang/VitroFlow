import { AlertDialog, Button, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { selectDatasetModelVersion } from "../../server/models";
import type { WorkerCount } from "../../server/overview";

/** Makes a candidate version the one the dataset prelabels with. */
export function SelectVersionDialog({
  dataset,
  versionId,
  label,
  serving,
}: {
  dataset: string;
  versionId: string;
  label: string;
  serving: WorkerCount;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog>
      <Button variant="ghost" size="sm" isDisabled={busy}>
        Select
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            {({ close }) => (
              <>
                <AlertDialog.Header>
                  <AlertDialog.Icon />
                  <AlertDialog.Heading>Prelabel with {label}?</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  Images in {dataset} that are not yet under review become
                  pending for this version. Reviewed annotations keep their
                  original prelabels.
                  {serving.online === 0 &&
                    " No inference worker currently serves this version, so nothing is detected until one connects."}
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
                      void selectDatasetModelVersion({ data: { dataset, versionId } })
                        .then(async () => {
                          close();
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Version not selected", {
                            description:
                              cause instanceof Error ? cause.message : String(cause),
                          });
                        })
                        .finally(() => {
                          setBusy(false);
                        });
                    }}
                  >
                    Select
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
