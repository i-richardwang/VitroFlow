import { collectUnreferencedModelWeights } from "../models/public";
import { collectImages } from "../images/public";
import { collectUnreferencedTrainingCheckpoints } from "../training/public";

interface CollectedBlobs {
  images: string[];
  modelWeights: string[];
  trainingCheckpoints: string[];
}

export async function collectUnreferencedBlobs(): Promise<CollectedBlobs> {
  return {
    images: await collectImages(),
    modelWeights: await collectUnreferencedModelWeights(),
    trainingCheckpoints: await collectUnreferencedTrainingCheckpoints(),
  };
}
