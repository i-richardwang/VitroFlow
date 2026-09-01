export class ExperimentNotFoundError extends Error {}
export class ExperimentHasRecordsError extends Error {}
export class ImagesNotStoredError extends Error {}
export class ExperimentObservationImageNotFoundError extends Error {}
export class ObservationNotFoundError extends Error {}
export class ObservationRejectedError extends Error {}
export class TreatmentNotFoundError extends Error {}
export class TreatmentRejectedError extends Error {}
export class ObservationUnitNotFoundError extends Error {}
export class ObservationUnitRejectedError extends Error {}
export class CultureEventNotFoundError extends Error {}
export class ObservationImageRejectedError extends Error {}

export interface UsedExperimentObservationImage {
  digest: string;
  filename: string;
  observationUnit: string;
  day: number;
}

export class ExperimentObservationImageAlreadyUsedError extends Error {
  constructor(public readonly images: UsedExperimentObservationImage[]) {
    const [first] = images;
    super(
      first
        ? `${first.filename} already represents observation unit ${first.observationUnit} on day ${first.day}`
        : "An image was already used in this experiment",
    );
  }
}
