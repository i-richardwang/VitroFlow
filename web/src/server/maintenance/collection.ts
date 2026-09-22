import { collectImages } from "../images/public";
import { collectUnreferencedModelWeights } from "../training/public";

interface CollectedBlobs {
  images: string[];
  modelWeights: string[];
}

export async function collectUnreferencedBlobs(): Promise<CollectedBlobs> {
  return {
    images: await collectImages(),
    modelWeights: await collectUnreferencedModelWeights(),
  };
}
