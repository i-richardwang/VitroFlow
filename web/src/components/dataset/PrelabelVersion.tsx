import { Chip } from "@heroui/react";

import type { Dataset } from "../../datasets/schema";
import { versionSlug } from "../../models/schema";
import { Hint } from "../Hint";

/** Warning when this image's prelabel is not the selected version. */
export function PrelabelVersion({
  dataset,
  versionId,
}: {
  dataset: Dataset;
  versionId: string | null;
}) {
  if (versionId === null || versionId === dataset.selectedModelVersionId) {
    return null;
  }
  return (
    <Hint text="Not the selected prelabel version">
      <Chip color="warning" variant="soft" size="sm">
        {versionSlug({ id: versionId, modelId: dataset.modelId })}
      </Chip>
    </Hint>
  );
}
