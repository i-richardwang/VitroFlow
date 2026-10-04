import type { AnnotationProposal } from "../annotation-runs/schema";
import { owns } from "../annotation-runs/tasks";
import type { AnnotationInstance, BoundingBox } from "./schema";

/** A place an AI proposal asks a person to look at. */
export type Check =
  | { kind: "uncertain"; bbox: BoundingBox }
  | { kind: "issue"; bbox: BoundingBox; reason: string };

function unchanged(
  item: AnnotationInstance,
  now: AnnotationInstance | undefined,
): boolean {
  return (
    now !== undefined &&
    now.class === item.class &&
    now.bbox.x === item.bbox.x &&
    now.bbox.y === item.bbox.y &&
    now.bbox.width === item.bbox.width &&
    now.bbox.height === item.bbox.height
  );
}

/**
 * What a proposal still asks of the boxes in view. A box
 * the agent was unsure of stays open until it is moved, resized, reclassified
 * or removed; an area it questioned stays open until the boxes centered in it
 * change. Saving a review retires them all, since the review outranks the
 * proposal.
 */
export function openChecks(
  proposal: AnnotationProposal,
  instances: AnnotationInstance[],
): Check[] {
  const now = new Map(instances.map((item) => [item.id, item]));
  const proposed = proposal.document.instances;
  const uncertain = new Set(proposal.uncertainIds);
  return [
    ...proposed
      .filter(
        (item) => uncertain.has(item.id) && unchanged(item, now.get(item.id)),
      )
      .map(({ bbox }) => ({ kind: "uncertain" as const, bbox })),
    ...proposal.issues
      .filter(({ bbox }) => {
        const before = proposed.filter((item) => owns(bbox, item.bbox));
        return (
          before.length ===
            instances.filter((item) => owns(bbox, item.bbox)).length &&
          before.every((item) => unchanged(item, now.get(item.id)))
        );
      })
      .map(({ bbox, reason }) => ({ kind: "issue" as const, bbox, reason })),
  ];
}
