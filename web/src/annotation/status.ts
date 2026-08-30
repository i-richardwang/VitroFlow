import { annotationSchema, type AnnotationDocument } from "./schema";

export type ReviewEvent =
  | { type: "edit" }
  | { type: "complete" }
  | { type: "reopen" }
  | { type: "exclude"; reason?: string }
  | { type: "include" };

export class ReviewTransitionError extends Error {}

/** Only a completed review is a settled observation outside the editor. */
export function isCompletedReview(
  document: AnnotationDocument,
): document is AnnotationDocument & { status: "complete" } {
  return document.status === "complete";
}

/** Applies a review event; editing a completed image sends it back to review. */
export function transition(
  document: AnnotationDocument,
  event: ReviewEvent,
): AnnotationDocument {
  const { status } = document;
  switch (event.type) {
    case "edit":
      return status === "complete"
        ? { ...document, status: "in_progress" }
        : document;
    case "complete": {
      if (status !== "in_progress") {
        throw new ReviewTransitionError(`Cannot complete from ${status}`);
      }
      const parsed = annotationSchema.safeParse(document);
      if (!parsed.success) {
        throw new ReviewTransitionError(parsed.error.issues[0].message);
      }
      return { ...document, status: "complete" };
    }
    case "reopen":
      if (status !== "complete") {
        throw new ReviewTransitionError(`Cannot reopen from ${status}`);
      }
      return { ...document, status: "in_progress" };
    case "exclude": {
      const { excludedReason: _, ...rest } = document;
      return event.reason
        ? { ...rest, status: "excluded", excludedReason: event.reason }
        : { ...rest, status: "excluded" };
    }
    case "include": {
      if (status !== "excluded") {
        throw new ReviewTransitionError(`Cannot include from ${status}`);
      }
      const { excludedReason: _, ...rest } = document;
      return { ...rest, status: "in_progress" };
    }
  }
}
