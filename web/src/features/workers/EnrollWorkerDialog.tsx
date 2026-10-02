import {
  Button,
  Description,
  Form,
  Input,
  Label,
  Modal,
  TextField,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { EnrolledWorker } from "../../domain/workers/schema";
import { addWorker } from "../../functions/status";
import { m } from "../../paraglide/messages";
import { CopyableCode } from "../../ui/CopyableCode";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";

/**
 * An administrator names a machine and receives the token it connects with,
 * together with the command that sets the machine up.
 */
export function EnrollWorkerDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Editor
      key={isOpen ? "open" : "closed"}
      isOpen={isOpen}
      onClose={onClose}
    />
  );
}

function Editor({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [enrolled, setEnrolled] = useState<EnrolledWorker | null>(null);

  const close = () => {
    onClose();
    if (enrolled) void router.invalidate();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && close()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            {enrolled ? (
              <>
                <Modal.Header>
                  <Modal.Heading>{m.worker_enroll_ready()}</Modal.Heading>
                  <Description>{m.worker_enroll_shown_once()}</Description>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-4">
                  <CopyableCode
                    value={`vitroflow worker setup ${enrolled.workerId} --server ${window.location.origin}`}
                    label={m.worker_enroll_command_label()}
                    description={m.worker_enroll_command_description()}
                  />
                  <CopyableCode
                    value={enrolled.token}
                    label={m.worker_enroll_token_label()}
                  />
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="primary" onPress={close}>
                    {m.close()}
                  </Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header>
                  <Modal.Heading>{m.worker_enroll_title()}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <Form
                    id="enroll-worker"
                    className="flex w-full min-w-0 flex-col gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void run(
                        () =>
                          addWorker({
                            data: {
                              workerId: String(form.get("workerId") ?? ""),
                            },
                          }),
                        m.worker_enroll_failed(),
                      ).then((result) => {
                        if (result.ok) setEnrolled(result.value);
                      });
                    }}
                  >
                    <TextField
                      variant="secondary"
                      fullWidth
                      isRequired
                      isDisabled={busy}
                      name="workerId"
                      autoFocus
                    >
                      <Label>{m.worker_enroll_name_label()}</Label>
                      <Input
                        className="w-full font-mono"
                        autoComplete="off"
                        pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,127}"
                        placeholder={m.worker_enroll_name_placeholder()}
                      />
                      <Description>
                        {m.worker_enroll_name_description()}
                      </Description>
                    </TextField>
                  </Form>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" isDisabled={busy} onPress={close}>
                    {m.cancel()}
                  </Button>
                  <Button
                    type="submit"
                    form="enroll-worker"
                    variant="primary"
                    isDisabled={busy}
                  >
                    {busy
                      ? m.worker_enroll_creating()
                      : m.worker_enroll_create()}
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
