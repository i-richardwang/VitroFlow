import { Link } from "@tanstack/react-router";
import { Images } from "lucide-react";

import { m } from "../../paraglide/messages";
import { SummaryCard, SummaryCardStats } from "../../ui/kit/SummaryCard";
import { formatCount } from "../../ui/numbers";
import { datasetImageStateLabel } from "./labels";

/** A training set on its model's page: its images, and how many are reviewed and so can train. */
export function DatasetCard({
  dataset,
  images,
  reviewed,
}: {
  dataset: string;
  images: number;
  reviewed: number;
}) {
  return (
    <SummaryCard
      icon={Images}
      title={dataset}
      render={<Link to="/datasets/$dataset" params={{ dataset }} />}
      footer={
        <SummaryCardStats
          items={[
            { label: m.dataset_images(), value: formatCount(images) },
            {
              label: datasetImageStateLabel("reviewed"),
              value: formatCount(reviewed),
            },
          ]}
        />
      }
    />
  );
}
