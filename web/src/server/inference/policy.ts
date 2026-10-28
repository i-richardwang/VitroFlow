import type { ModelArtifact } from "../../domain/models/schema";

export const INFERENCE_LEASE_SECONDS = 90;
export const INFERENCE_MAX_ATTEMPTS = 3;
export const INFERENCE_WORKER_COOLDOWN_SECONDS = 60;

/** Cold loading, transfer and inference share a fixed, server-owned budget.
 * Larger inference inputs receive more time; the budget never grows on renewal.
 */
export function inferenceBudgetSeconds(artifact: ModelArtifact): number {
  if (artifact.kind === "traditional") return 600;
  return Math.min(
    1800,
    600 + 120 * Math.ceil((artifact.inference.imageSize / 1024) ** 2),
  );
}

export function retryDelaySeconds(attempts: number): number {
  return Math.min(60, 5 * 2 ** Math.max(0, attempts - 1));
}
