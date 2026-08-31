export class ExperimentNotFoundError extends Error {}
export class ExperimentDesignLockedError extends Error {}
export class ExperimentDesignIncompleteError extends Error {}
export class ExperimentHasRecordsError extends Error {}
export class ImagesNotStoredError extends Error {}
export class ExperimentPhotoNotFoundError extends Error {}
export class ObservationNotFoundError extends Error {}
export class ObservationRejectedError extends Error {}
export class TreatmentNotFoundError extends Error {}
export class TreatmentRejectedError extends Error {}
export class DishNotFoundError extends Error {}
export class DishRejectedError extends Error {}
export class DishEventNotFoundError extends Error {}
export class PhotoRejectedError extends Error {}

export interface UsedExperimentPhoto {
  digest: string;
  filename: string;
  dish: string;
  day: number;
}

export class ExperimentPhotoAlreadyUsedError extends Error {
  constructor(public readonly photos: UsedExperimentPhoto[]) {
    const [first] = photos;
    super(
      first
        ? `${first.filename} already stands for dish ${first.dish} on day ${first.day}`
        : "A photograph was already used in this experiment",
    );
  }
}
