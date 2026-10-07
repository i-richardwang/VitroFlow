import type { AnnotationProposal } from "../annotation-runs/schema";
import { sameBox } from "./geometry";
import type { AnnotationInstance } from "./schema";

function unchanged(
  item: AnnotationInstance,
  now: AnnotationInstance | undefined,
): boolean {
  return (
    now !== undefined &&
    now.class === item.class &&
    sameBox(now.bbox, item.bbox)
  );
}

/**
 * The boxes a proposal still asks a person to confirm, given the boxes in
 * view. Each stays open until it is moved, resized, reclassified or removed;
 * saving a review retires them all, since the review outranks the proposal.
 */
export function openChecks(
  proposal: AnnotationProposal,
  instances: AnnotationInstance[],
): AnnotationInstance[] {
  const now = new Map(instances.map((item) => [item.id, item]));
  const uncertain = new Set(proposal.uncertainIds);
  return proposal.document.instances.filter(
    (item) => uncertain.has(item.id) && unchanged(item, now.get(item.id)),
  );
}
