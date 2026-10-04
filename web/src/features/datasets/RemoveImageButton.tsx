import { useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";

import { removeFromDataset } from "../../functions/datasets";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { toast } from "../../ui/kit/Toast";
import { m } from "../../paraglide/messages";

/** Takes one image out of a dataset, after asking. */
export function RemoveImageButton({
  dataset,
  image,
}: {
  dataset: string;
  image: { digest: string; filename: string };
}) {
  const router = useRouter();

  return (
    <ActionIcon
      icon={Trash2}
      size="small"
      title={m.dataset_remove()}
      onClick={() =>
        confirmDestructive({
          title: m.dataset_remove_title({ file: image.filename, dataset }),
          confirmLabel: m.dataset_remove(),
          onConfirm: async () => {
            await removeFromDataset({
              data: { dataset, digest: image.digest },
            });
            toast.success(
              m.dataset_image_removed({ file: image.filename, dataset }),
            );
            await router.invalidate();
          },
        })
      }
    />
  );
}
