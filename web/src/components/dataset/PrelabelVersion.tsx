import type { Dataset } from "../../datasets/schema";
import { versionSlug } from "../../models/schema";

/** The version that produced an image's prelabel, flagged once the dataset moved on. */
export function PrelabelVersion({
  dataset,
  versionId,
}: {
  dataset: Dataset;
  versionId: string | null;
}) {
  if (versionId === null) {
    return <span className="text-muted">—</span>;
  }
  const current = versionId === dataset.selectedModelVersionId;
  return (
    <span
      className={`font-mono text-xs ${current ? "text-muted" : "text-warning"}`}
      title={
        current ? versionId : `${versionId} is no longer the selected version`
      }
    >
      {versionSlug({ id: versionId, modelId: dataset.modelId })}
    </span>
  );
}
