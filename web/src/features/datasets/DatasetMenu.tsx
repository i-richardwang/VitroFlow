import { Download } from "lucide-react";

import { m } from "../../paraglide/messages";
import { PageMenu } from "../../ui/ActionsMenu";

/**
 * A dataset page's secondary actions. The archive is served as an
 * attachment, so following it downloads the file and leaves the page open.
 */
export function DatasetMenu({ dataset }: { dataset: string }) {
  return (
    <PageMenu
      label={m.dataset_actions({ dataset })}
      items={[
        {
          key: "download",
          icon: Download,
          label: m.dataset_download(),
          href: `/datasets/${encodeURIComponent(dataset)}/archive`,
        },
      ]}
    />
  );
}
