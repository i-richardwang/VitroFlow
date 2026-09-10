import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  Modal,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { addModel } from "../../functions/models";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";

/** Classes are written one per line, the way a reviewer lists what to look for. */
function classList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Names a task the workbench did not have. */
function ModelDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>{m.model_new()}</Modal.Heading>
            </Modal.Header>
            <Editor key={isOpen ? "open" : "closed"} onClose={onClose} />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function Editor({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [classes, setClasses] = useState("");

  const submit = () => {
    void run(
      () => addModel({ data: { id, name, classes: classList(classes) } }),
      m.model_not_created(),
    ).then(async (result) => {
      if (!result.ok) return;
      toast.success(m.model_created({ name: result.value.name }));
      onClose();
      await router.invalidate();
    });
  };

  return (
    <>
      <Modal.Body>
        <Form
          id="model"
          className="flex w-full min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <TextField
            variant="secondary"
            fullWidth
            isRequired
            isDisabled={busy}
            value={name}
            onChange={setName}
          >
            <Label>{m.model_name_label()}</Label>
            <Input className="w-full" />
            <FieldError />
          </TextField>
          <TextField
            variant="secondary"
            fullWidth
            isRequired
            isDisabled={busy}
            value={id}
            onChange={setId}
          >
            <Label>{m.model_id_label()}</Label>
            <Input
              className="w-full font-mono"
              placeholder={m.model_id_placeholder()}
            />
            <FieldError />
          </TextField>
          <TextField
            variant="secondary"
            fullWidth
            isRequired
            isDisabled={busy}
            value={classes}
            onChange={setClasses}
          >
            <Label>{m.model_classes_label()}</Label>
            <TextArea
              className="w-full font-mono"
              rows={3}
              placeholder={m.model_classes_placeholder()}
            />
            <FieldError />
          </TextField>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
          {m.cancel()}
        </Button>
        <Button type="submit" form="model" variant="primary" isDisabled={busy}>
          {busy
            ? m.action_in_progress({ action: m.model_create() })
            : m.model_create()}
        </Button>
      </Modal.Footer>
    </>
  );
}

export function ModelDialogButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        {m.model_new()}
      </Button>
      <ModelDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
