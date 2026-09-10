import { ConflictError, NotFoundError } from "../errors";

export class ExperimentNotFoundError extends NotFoundError {
  readonly code = "experiment_not_found";
}
export class ModelVersionNotFoundError extends NotFoundError {
  readonly code = "model_version_not_found";
}
export class ExperimentObservationImageNotFoundError extends NotFoundError {
  readonly code = "experiment_observation_image_not_found";
}
export class ObservationNotFoundError extends NotFoundError {
  readonly code = "observation_not_found";
}
export class TreatmentNotFoundError extends NotFoundError {
  readonly code = "treatment_not_found";
}
export class UnitNotFoundError extends NotFoundError {
  readonly code = "unit_not_found";
}
export class CultureEventNotFoundError extends NotFoundError {
  readonly code = "culture_event_not_found";
}

export class ExperimentRejectedError extends ConflictError {
  readonly code = "experiment_rejected";
}
export class ExperimentHasRecordsError extends ConflictError {
  readonly code = "experiment_has_records";
}
export class ImagesNotStoredError extends ConflictError {
  readonly code = "images_not_stored";
}
export class ObservationRejectedError extends ConflictError {
  readonly code = "observation_rejected";
}
export class TreatmentRejectedError extends ConflictError {
  readonly code = "treatment_rejected";
}
export class UnitRejectedError extends ConflictError {
  readonly code = "unit_rejected";
}
export class ObservationImageRejectedError extends ConflictError {
  readonly code = "observation_image_rejected";
}

export interface UsedExperimentObservationImage {
  digest: string;
  filename: string;
  unit: string;
  day: number;
}

export class ExperimentObservationImageAlreadyUsedError extends ConflictError {
  readonly code = "experiment_observation_image_already_used";
  override get details() {
    return {
      images: this.images.map(({ digest, filename, unit, day }) => ({
        digest,
        filename,
        unit,
        day,
      })),
    };
  }
  constructor(public readonly images: UsedExperimentObservationImage[]) {
    const [first] = images;
    super(
      first
        ? `${first.filename} already represents unit ${first.unit} on day ${first.day}`
        : "An image was already used in this experiment",
    );
  }
}
