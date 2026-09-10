import { ConflictError, NotFoundError } from "../errors";

export class ModelNotFoundError extends NotFoundError {
  readonly code = "model_not_found";
}
export class ModelNameTakenError extends ConflictError {
  readonly code = "model_name_taken";
}
export class ModelInUseError extends ConflictError {
  readonly code = "model_in_use";
}
