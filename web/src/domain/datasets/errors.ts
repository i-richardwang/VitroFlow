import { NotFoundError, ConflictError, ValidationError } from "../errors";

export class ObservationImageNotFoundError extends NotFoundError {
  readonly code = "dataset_observation_image_not_found";
}
export class DatasetNotFoundError extends NotFoundError {
  readonly code = "dataset_not_found";
}
export class DatasetModelError extends ConflictError {
  readonly code = "dataset_model_mismatch";
}
export class DatasetImportError extends ValidationError {
  readonly code = "dataset_import_rejected";
}
