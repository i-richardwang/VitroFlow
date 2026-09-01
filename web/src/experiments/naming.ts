/** Numbers inside codes compare by value, so `A2` precedes `A10`. */
export function compareObservationUnitCodes(
  left: string,
  right: string,
): number {
  return left.localeCompare(right, "en", { numeric: true });
}

/**
 * The design's treatments in their own order, each followed by its replicates,
 * with unassigned observation units last.
 */
export function observationUnitOrder<
  Unit extends { code: string; treatment: string | null },
>(
  observationUnits: readonly Unit[],
  treatments: readonly { id: string; position: number }[],
): Unit[] {
  const rank = new Map(treatments.map((item) => [item.id, item.position]));
  const group = (observationUnit: Unit) =>
    observationUnit.treatment === null
      ? Number.MAX_SAFE_INTEGER
      : (rank.get(observationUnit.treatment) ?? Number.MAX_SAFE_INTEGER);
  return [...observationUnits].sort(
    (left, right) =>
      group(left) - group(right) ||
      compareObservationUnitCodes(left.code, right.code),
  );
}

/**
 * The codes a treatment's replicates take: `T1-1` through `T1-n`, skipping
 * any the experiment already uses so that adding replicates continues the
 * series instead of colliding with it.
 */
export function replicateCodes(
  treatment: string,
  replicates: number,
  taken: readonly string[],
): string[] {
  const used = new Set(taken.map(observationUnitCodeKey));
  const codes: string[] = [];
  for (let replicate = 1; codes.length < replicates; replicate += 1) {
    const code = `${treatment}-${replicate}`;
    if (used.has(observationUnitCodeKey(code))) continue;
    used.add(observationUnitCodeKey(code));
    codes.push(code);
  }
  return codes;
}

function normalizedDesignKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function treatmentNameKey(name: string): string {
  return normalizedDesignKey(name);
}

export function observationUnitCodeKey(code: string): string {
  return normalizedDesignKey(code);
}

/** The filename without its extension, as the camera or the operator wrote it. */
export function filenameStem(filename: string): string {
  const normalized = filename.normalize("NFC").trim();
  const dot = normalized.lastIndexOf(".");
  return (dot > 0 ? normalized.slice(0, dot) : normalized).trim();
}

/**
 * The observation unit a filename most likely shows. A stem that normalizes to
 * a code names it outright; otherwise a stem ending in a code after a
 * separator does, which is how `IMG_0413_T1-2` survives a camera.
 */
export function suggestObservationUnit(
  filename: string,
  codes: readonly string[],
): string | null {
  const stem = observationUnitCodeKey(filenameStem(filename));
  if (!stem) return null;
  const exact = codes.filter((code) => observationUnitCodeKey(code) === stem);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const suffixed = codes.filter((code) =>
    stem.endsWith(`-${observationUnitCodeKey(code)}`),
  );
  if (suffixed.length !== 1) return null;
  return suffixed[0]!;
}
