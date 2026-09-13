import { Button, Dropdown, Label, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Model } from "../../domain/models/schema";
import { removeModel } from "../../functions/models";
import { m } from "../../paraglide/messages";
import { DestructiveActionDialog } from "../../ui/DestructiveActionDialog";
import { MoreIcon } from "../../ui/icons";
import { modelName } from "../../ui/model-names";

export function ModelMenu({ model }: { model: Model }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const name = modelName(model);
  const label = m.model_menu_label({ name });

  return (
    <>
      <Dropdown>
        <Button variant="ghost" isIconOnly size="sm" aria-label={label}>
          <MoreIcon />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu aria-label={label} onAction={() => setOpen(true)}>
            <Dropdown.Item
              id="delete"
              textValue={m.model_menu_delete({ name })}
              variant="danger"
            >
              <Label>{m.model_delete()}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <DestructiveActionDialog
        isOpen={open}
        onOpenChange={setOpen}
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
