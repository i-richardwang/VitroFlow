import {
  Button,
  Description,
  Dropdown,
  Form,
  Label,
  Modal,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Model } from "../../domain/models/schema";
import { removeModel, updateModelAnnotation } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../../ui/DestructiveActionDialog";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { MoreIcon } from "../../ui/icons";
import { modelName } from "../../ui/model-names";

export function ModelMenu({
  model,
  deletable,
}: {
  model: Model;
  deletable: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"annotation" | "delete" | null>(null);
  const name = modelName(model);
  const label = m.model_menu_label({ name });

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly size="sm" aria-label={label}>
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label={label}
            onAction={(key) =>
              setDialog(key === "delete" ? "delete" : "annotation")
            }
          >
            <Dropdown.Item
              id="annotation"
              textValue={m.model_menu_annotation()}
            >
              <Label>{m.model_menu_annotation()}</Label>
            </Dropdown.Item>
            {deletable ? (
              <Dropdown.Item
                id="delete"
                textValue={m.model_menu_delete({ name })}
                variant="danger"
              >
                <Label>{m.model_delete()}</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Modal
        isOpen={dialog === "annotation"}
        onOpenChange={(next) => !next && setDialog(null)}
      >
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger aria-label={m.close()} />
              <Modal.Header>
                <Modal.Heading>
                  {m.model_annotation_title({ name })}
                </Modal.Heading>
              </Modal.Header>
              {dialog === "annotation" ? (
                <AnnotationEditor
                  model={model}
                  onClose={() => setDialog(null)}
                />
              ) : null}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <DestructiveActionDialog
        isOpen={dialog === "delete"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={m.model_menu_delete({ name })}
        confirmLabel={m.model_delete()}
        onConfirm={async () => {
          await removeModel({ data: { model: model.id } });
          toast.success(m.model_deleted({ name }));
          await router.invalidate();
        }}
      />
    </>
  );
}

function AnnotationEditor({
  model,
  onClose,
}: {
  model: Model;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [instructions, setInstructions] = useState(
    model.annotation.instructions,
  );
  const name = modelName(model);
  const submit = () => {
    void run(
      () =>
        updateModelAnnotation({
          data: {
            model: model.id,
            annotation: { ...model.annotation, instructions },
          },
        }),
      m.model_annotation_not_saved(),
    ).then(async (result) => {
      if (!result.ok) return;
      toast.success(m.model_annotation_saved({ name }));
      onClose();
      await router.invalidate();
    });
  };
  return (
    <>
      <Modal.Body>
        <Form
          id="model-annotation"
          className="flex w-full min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <TextField
            variant="secondary"
            fullWidth
            isDisabled={busy}
            value={instructions}
            onChange={setInstructions}
          >
            <Label>{m.model_annotation_label()}</Label>
            <TextArea
              className="w-full"
              rows={8}
              placeholder={m.model_annotation_placeholder()}
            />
            <Description>
              {m.model_annotation_region({
                size: model.annotation.coreSize,
                halo: model.annotation.halo,
                scale: model.annotation.displayScale,
              })}
            </Description>
          </TextField>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
          {m.cancel()}
        </Button>
        <Button
          type="submit"
          form="model-annotation"
          variant="primary"
          isDisabled={busy}
        >
          {busy
            ? m.action_in_progress({ action: m.model_annotation_save() })
            : m.model_annotation_save()}
        </Button>
      </Modal.Footer>
    </>
  );
}
