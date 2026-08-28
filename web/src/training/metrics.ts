import type { TrainingEpoch } from "./schema";

/** The epoch with the highest fitness; what Ultralytics keeps as `best.pt`. */
export function bestEpoch(epochs: TrainingEpoch[]): TrainingEpoch | null {
  let best: TrainingEpoch | null = null;
  for (const epoch of epochs) {
    if (!best || epoch.fitness > best.fitness) best = epoch;
  }
  return best;
}
