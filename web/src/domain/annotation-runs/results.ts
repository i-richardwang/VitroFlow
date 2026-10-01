import { annotationRunResultSchema, type AnnotationDefinition } from "./schema";
import {
  owns,
  projectProposal,
  seamWarnings,
  tiles,
  type Region,
  type RegionProposal,
} from "./tasks";

/**
 * The image as the run leaves it: the accepted answer of every region it
 * redrew, and in the regions it did not, the boxes it began from. A box
 * belongs to the region holding its center, so each part of the image is
 * read by exactly one of the two.
 */
export function collectRegions(
  definition: AnnotationDefinition,
  tasks: { taskId: string; region: Region; response: RegionProposal | null }[],
) {
  const instances = [],
    issues = [],
    uncertainIds: string[] = [];
  for (const task of tasks) {
    const content = projectProposal(task.response!, task.region, definition);
    instances.push(
      ...content.document.instances.map((item) => ({
        ...item,
        id: `${task.taskId}/${item.id}`,
        taskId: task.taskId,
      })),
    );
    uncertainIds.push(
      ...content.uncertainIds.map((id) => `${task.taskId}/${id}`),
    );
    issues.push(...content.issues);
  }
  const redrawn = new Set(tasks.map((task) => task.region.id));
  const inputUncertain = new Set(definition.inputNotes?.uncertainIds);
  for (const tile of tiles(definition)) {
    if (redrawn.has(tile.id)) continue;
    for (const item of definition.input ?? []) {
      if (owns(tile.core, item.bbox)) {
        instances.push({ ...item, taskId: tile.id });
        if (inputUncertain.has(item.id)) uncertainIds.push(item.id);
      }
    }
    for (const issue of definition.inputNotes?.issues ?? []) {
      if (owns(tile.core, issue.bbox)) issues.push(issue);
    }
  }
  return annotationRunResultSchema.parse({
    document: {
      schemaVersion: 1,
      image: definition.image,
      instances: instances.map(({ taskId: _, ...instance }) => instance),
    },
    issues,
    warnings: seamWarnings(instances),
    uncertainIds,
  });
}
