import { collectImages } from "../images/public";
import { collectUnreferencedModelWeights } from "../training/public";

interface CollectedBlobs {
  images: string[];
  modelWeights: string[];
}

/** Collects every immutable object type according to its ownership rules. */
export async function collectUnreferencedBlobs(): Promise<CollectedBlobs> {
  return {
    images: await collectImages(),
    modelWeights: await collectUnreferencedModelWeights(),
  };
}
