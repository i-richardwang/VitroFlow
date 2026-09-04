import type {
  AnnotationDocument,
  AnnotationInstance,
  ReviewState,
} from "./schema";

/**
 * How the image reads outside the editor. A review reaches revision 1 when it
 * is first stored, so the copy of a detection the editor opens on is still an
 * image nobody has reviewed.
 */
export function reviewState(document: AnnotationDocument | null): ReviewState {
  return document && document.revision > 0 ? document.status : "unreviewed";
}

/** The review with its boxes changed, which puts it back in progress. */
export function editReview(
  document: AnnotationDocument,
  instances: AnnotationInstance[],
): AnnotationDocument {
  return { ...document, instances, status: "in_progress" };
}

/** The review as the reviewer leaves it when they are done. */
export function finishReview(document: AnnotationDocument): AnnotationDocument {
  return { ...document, status: "complete" };
}
