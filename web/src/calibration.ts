import type { Correction, Point } from "./schemas";

/** Detection ids a correction consumes. */
export function consumedIds(correction: Correction): number[] {
  switch (correction.type) {
    case "remove":
      return [correction.id];
    case "add":
      return [];
    case "merge":
      return correction.ids;
    case "split":
      return [correction.id];
  }
}

/** Seed positions a correction asserts in place of the detections it consumes. */
export function assertedSeeds(correction: Correction): Point[] {
  switch (correction.type) {
    case "remove":
      return [];
    case "add":
      return [correction.point];
    case "merge":
      return [correction.point];
    case "split":
      return correction.points;
  }
}

export function calibratedCount(
  algorithmCount: number,
  corrections: Correction[],
): number {
  return corrections.reduce(
    (count, correction) =>
      count + assertedSeeds(correction).length - consumedIds(correction).length,
    algorithmCount,
  );
}

/** Maps each consumed detection id to the index of the correction that owns it. */
export function correctionOwners(
  corrections: Correction[],
): Map<number, number> {
  const owners = new Map<number, number>();
  corrections.forEach((correction, index) => {
    for (const id of consumedIds(correction)) {
      owners.set(id, index);
    }
  });
  return owners;
}

export function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}
