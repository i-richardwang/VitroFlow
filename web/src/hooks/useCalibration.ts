import { useState } from "react";

import { centroid, correctionOwners } from "../calibration";
import type { Correction, Point, SeedDetection } from "../schemas";
import { saveCalibration } from "../server/runs";

export interface CalibrationState {
  corrections: Correction[];
  saving: boolean;
  removeDetection: (id: number) => void;
  addSeed: (point: Point) => void;
  /** Declares two detections to be one seed; joins an existing merge when either is in one. */
  mergeDetections: (sourceId: number, targetId: number) => void;
  /** Declares a detection to be several seeds, one at its center and one at each split point. */
  splitDetection: (id: number, point: Point) => void;
  revert: (index: number) => void;
}

export function useCalibration(
  runId: string,
  stem: string,
  detections: SeedDetection[],
  initial: Correction[],
): CalibrationState {
  const [corrections, setCorrections] = useState(initial);
  const [saving, setSaving] = useState(false);

  const byId = new Map(
    detections.map((detection) => [detection.id, detection]),
  );
  const owners = correctionOwners(corrections);

  const apply = (next: Correction[]) => {
    setCorrections(next);
    setSaving(true);
    saveCalibration({ data: { runId, stem, corrections: next } }).finally(() =>
      setSaving(false),
    );
  };

  const append = (correction: Correction) =>
    apply([...corrections, correction]);

  return {
    corrections,
    saving,
    removeDetection: (id) => append({ type: "remove", id }),
    addSeed: (point) => append({ type: "add", point }),
    mergeDetections: (sourceId, targetId) => {
      const members = new Set([sourceId, targetId]);
      const absorbed = new Set<number>();
      for (const id of [sourceId, targetId]) {
        const index = owners.get(id);
        if (index === undefined) {
          continue;
        }
        const owner = corrections[index];
        if (owner.type !== "merge") {
          return;
        }
        absorbed.add(index);
        for (const member of owner.ids) {
          members.add(member);
        }
      }
      const ids = [...members].sort((a, b) => a - b);
      const point = centroid(ids.map((id) => byId.get(id)!));
      apply([
        ...corrections.filter((_, index) => !absorbed.has(index)),
        { type: "merge", ids, point },
      ]);
    },
    splitDetection: (id, point) => {
      const index = owners.get(id);
      if (index === undefined) {
        const detection = byId.get(id)!;
        append({
          type: "split",
          id,
          points: [{ x: detection.x, y: detection.y }, point],
        });
        return;
      }
      const owner = corrections[index];
      if (owner.type !== "split") {
        return;
      }
      apply(
        corrections.map((correction, current) =>
          current === index
            ? { ...owner, points: [...owner.points, point] }
            : correction,
        ),
      );
    },
    revert: (index) =>
      apply(corrections.filter((_, current) => current !== index)),
  };
}
