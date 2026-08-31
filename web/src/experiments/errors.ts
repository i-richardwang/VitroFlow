export class ExperimentNotFoundError extends Error {}
export class ImagesNotStoredError extends Error {}
export class ExperimentPhotoNotFoundError extends Error {}
export class RoundNotFoundError extends Error {}
export class RoundRejectedError extends Error {}
export class TreatmentNotFoundError extends Error {}
export class TreatmentRejectedError extends Error {}
export class DishNotFoundError extends Error {}

export interface UsedExperimentPhoto {
  digest: string;
  filename: string;
  dish: string;
  round: string;
  roundLabel: string;
}

export class ExperimentPhotoAlreadyUsedError extends Error {
  constructor(public readonly photos: UsedExperimentPhoto[]) {
    const [first] = photos;
    super(
      first
        ? `${first.filename} was already used for dish ${first.dish} in ${first.roundLabel}`
        : "A photograph was already used in this experiment",
    );
  }
}
