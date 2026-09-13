import { Button, Dropdown, Label } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import { removeFromDataset } from "../../functions/datasets";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { MoreIcon } from "../../ui/icons";

export function ImageMenu({
  dataset,
  image,
}: {
  dataset: string;
  image: { digest: string; filename: string };
}) {
  const router = useRouter();
  const action = useAsyncAction();
  const label = m.dataset_menu_label({ file: image.filename });

  return (
    <Dropdown>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        isDisabled={action.busy}
        aria-label={label}
      >
        <MoreIcon />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={label}
          onAction={() => {
            void action
              .run(
                () =>
                  removeFromDataset({
                    data: { dataset, digest: image.digest },
                  }),
                m.dataset_image_not_removed(),
              )
              .then(async (result) => {
                if (result.ok) await router.invalidate();
              });
          }}
        >
          <Dropdown.Item
            id="remove"
            textValue={m.dataset_remove_image({ file: image.filename })}
            variant="danger"
          >
            <Label>{m.dataset_remove()}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
