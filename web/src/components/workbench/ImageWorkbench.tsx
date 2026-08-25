import type { AnnotationDocument } from "../../annotation/schema";
import type { SeedResult } from "../../detection/schema";
import { AnnotationEditor } from "./AnnotationEditor";
import { InitializeLabelCard } from "./InitializeLabelCard";
import { WorkbenchTopBar } from "./WorkbenchTopBar";

export function ImageWorkbench({
  runId,
  stem,
  result,
  label,
}: {
  runId: string;
  stem: string;
  result: SeedResult;
  label: AnnotationDocument | null;
}) {
  return (
    <div className="flex h-full flex-col">
      {label ? (
        <AnnotationEditor
          runId={runId}
          stem={stem}
          result={result}
          label={label}
        />
      ) : (
        <>
          <WorkbenchTopBar runId={runId} stem={stem} quality={result.quality} />
          <InitializeLabelCard
            runId={runId}
            stem={stem}
            detectionCount={result.count}
          />
        </>
      )}
    </div>
  );
}
