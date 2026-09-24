import { annotationRunResultSchema, type AnnotationDefinition } from "./schema";
import {
  owns,
  sourceBox,
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
    const response = task.response!;
    for (const item of response.instances) {
      const bbox = sourceBox(item.box_2d, task.region.patch);
      if (!owns(task.region.core, bbox)) continue;
      const id = `${task.taskId}/${item.id}`;
      instances.push({ id, class: item.class, bbox, taskId: task.taskId });
      const edges = item.box_2d;
      if (
        item.uncertain ||
        item.truncated ||
        edges.some((v) => v === 0 || v === 1000)
      )
        uncertainIds.push(id);
    }
    for (const issue of response.issues) {
      const bbox = sourceBox(issue.box_2d, task.region.patch);
      if (owns(task.region.core, bbox))
        issues.push({ bbox, reason: issue.reason });
    }
  }
  const redrawn = new Set(tasks.map((task) => task.region.id));
  for (const tile of tiles(definition)) {
    if (redrawn.has(tile.id)) continue;
    for (const item of definition.input ?? []) {
      if (owns(tile.core, item.bbox))
        instances.push({ ...item, taskId: tile.id });
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
