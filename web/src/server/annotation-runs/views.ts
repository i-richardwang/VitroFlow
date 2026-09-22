import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";
import { imageBlobKey } from "../images/public";
import { requireBlob } from "../infra/blobs/store";
import { readTask } from "./access";
import { savePreview } from "./tasks";
import { renderTask } from "./rendering";
export async function viewAnnotationTask(
  principal: AnnotationPrincipal,
  taskId: string,
) {
  const { run, task } = await readTask(principal, taskId);
  return renderTask(
    run.definition,
    task.region,
    await requireBlob(imageBlobKey(run.imageId)),
  );
}
export async function previewAnnotationTask(
  principal: AnnotationPrincipal,
  taskId: string,
  proposal: unknown,
) {
  const { run, task, response, proposalId } = await savePreview(
    principal,
    taskId,
    proposal,
  );
  return {
    proposalId,
    panels: await renderTask(
      run.definition,
      task.region,
      await requireBlob(imageBlobKey(run.imageId)),
      response,
    ),
  };
}
