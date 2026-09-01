/** A referenced record does not exist. */
export abstract class NotFoundError extends Error {}

/** Current state rejects the request; retrying unchanged cannot succeed. */
export abstract class ConflictError extends Error {}

export class ExperimentNotFoundError extends NotFoundError {}
export class ModelVersionNotFoundError extends NotFoundError {}
export class ExperimentObservationImageNotFoundError extends NotFoundError {}
export class ObservationNotFoundError extends NotFoundError {}
export class TreatmentNotFoundError extends NotFoundError {}
export class ObservationUnitNotFoundError extends NotFoundError {}
export class CultureEventNotFoundError extends NotFoundError {}

export class ExperimentHasRecordsError extends ConflictError {}
export class ImagesNotStoredError extends ConflictError {}
export class ObservationRejectedError extends ConflictError {}
export class TreatmentRejectedError extends ConflictError {}
export class ObservationUnitRejectedError extends ConflictError {}
export class ObservationImageRejectedError extends ConflictError {}

export interface UsedExperimentObservationImage {
  digest: string;
  filename: string;
  observationUnit: string;
  day: number;
}

export class ExperimentObservationImageAlreadyUsedError extends ConflictError {
  constructor(public readonly images: UsedExperimentObservationImage[]) {
    const [first] = images;
    super(
      first
        ? `${first.filename} already represents observation unit ${first.observationUnit} on day ${first.day}`
        : "An image was already used in this experiment",
    );
  }
}
