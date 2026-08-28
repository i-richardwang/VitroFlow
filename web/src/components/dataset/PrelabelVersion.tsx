import type { Dataset } from "../../datasets/schema";
import { versionSlug } from "../../models/schema";

/** Shown under an image name only when its prelabel is not the selected version. */
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
    <span
      className="mt-1 block font-mono text-xs font-normal text-warning"
      title={`${versionId} is no longer the selected version`}
    >
      {versionSlug({ id: versionId, modelId: dataset.modelId })}
    </span>
  );
}
