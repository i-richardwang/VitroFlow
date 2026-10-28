import type { TrainingRun } from "./schema";

/** How long a running run may go without progress before it reads as stalled. */
export const TRAINING_STALL_MINUTES = 15;

/**
 * Why a running run has stopped moving: its worker no longer holds it
 * (`worker-lost`), or it holds it without finishing a phase or an epoch for
 * `TRAINING_STALL_MINUTES` (`no-progress`).
 */
export type TrainingRunStall = "worker-lost" | "no-progress";

/**
 * Whether a run has stalled as of `at`. `leaseHeld` is whether its worker
 * still holds it as a claim judges it, its lease unexpired and its session
 * current, which only the server can tell.
 */
export function trainingRunStall(
  run: Pick<TrainingRun, "state" | "lastProgressAt">,
  { at, leaseHeld }: { at: Date; leaseHeld: boolean },
): TrainingRunStall | null {
  if (run.state.status !== "running") return null;
  if (!leaseHeld) return "worker-lost";
  if (
    run.lastProgressAt !== null &&
    at.getTime() - Date.parse(run.lastProgressAt) >
      TRAINING_STALL_MINUTES * 60_000
  )
    return "no-progress";
  return null;
}
