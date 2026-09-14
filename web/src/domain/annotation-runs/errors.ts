import { ConflictError, NotFoundError } from "../errors";

export class AnnotationRunConflictError extends ConflictError {
  readonly code = "annotation_run_conflict";
}
export class AnnotationRunNotFoundError extends NotFoundError {
  readonly code = "annotation_run_not_found";
}
