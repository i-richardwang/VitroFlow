import type { AnnotationPrincipal } from "../../domain/annotation-runs/access";
import { readImageRegion, readImageOverview } from "../images/public";
import { readTask } from "./access";
import { savePreview } from "./tasks";
import { renderContext, renderTask } from "./rendering";
export async function readAnnotationContext(
  principal: AnnotationPrincipal,
  taskId: string,
) {
  const { run } = await readTask(principal, taskId);
  return renderContext(
    run.id,
    run.definition,
    await readImageOverview(
      run.definition.image,
      run.definition.config,
      run.definition.scope,
      run.definition.coverage,
    ),
  );
}
export async function viewAnnotationTask(
  principal: AnnotationPrincipal,
  taskId: string,
) {
  const { run, task } = await readTask(principal, taskId);
  return renderTask(
    run.id,
    run.definition,
    task.region,
    await readImageRegion(
      run.definition.image,
      run.definition.config,
      task.region.id,
      run.definition.scope,
      run.definition.coverage,
    ),
  );
}
export async function previewAnnotationTask(
  principal: AnnotationPrincipal,
  taskId: string,
  proposal: unknown,
) {
  const { run, task, content, proposalId } = await savePreview(
    principal,
    taskId,
    proposal,
  );
  return {
    proposalId,
    panels: await renderTask(
      run.id,
      run.definition,
      task.region,
      await readImageRegion(
        run.definition.image,
        run.definition.config,
        task.region.id,
        run.definition.scope,
        run.definition.coverage,
      ),
      { content, proposalId },
    ),
  };
}
