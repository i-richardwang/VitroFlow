import { collectUnreferencedImages } from "./image-collection";
import { collectUnreferencedModelWeights } from "./model-weight-collection";

export interface CollectedBlobs {
  images: string[];
  modelWeights: string[];
}

/** Collects every immutable object type according to its ownership rules. */
export async function collectUnreferencedBlobs(): Promise<CollectedBlobs> {
  return {
    images: await collectUnreferencedImages(),
    modelWeights: await collectUnreferencedModelWeights(),
  };
}
