/** Numbers inside codes compare by value, so `A2` precedes `A10`. */
export function compareUnitCodes(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

/** The design's treatments in their own order, each followed by its replicates. */
export function unitOrder<Unit extends { code: string; treatment: string }>(
  units: readonly Unit[],
  treatments: readonly { id: string; position: number }[],
): Unit[] {
  const rank = new Map(treatments.map((item) => [item.id, item.position]));
  return [...units].sort(
    (left, right) =>
      rank.get(left.treatment)! - rank.get(right.treatment)! ||
      compareUnitCodes(left.code, right.code),
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
  const used = new Set(taken.map((code) => code.toLowerCase()));
  const codes: string[] = [];
  for (let replicate = 1; codes.length < replicates; replicate += 1) {
    const code = `${treatment}-${replicate}`;
    if (used.has(code.toLowerCase())) continue;
    used.add(code.toLowerCase());
    codes.push(code);
  }
  return codes;
}

/** Names and codes are identified the way the database compares them. */
export function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** The filename without its extension, as the camera or the operator wrote it. */
export function filenameStem(filename: string): string {
  const normalized = filename.normalize("NFC").trim();
  const dot = normalized.lastIndexOf(".");
  return (dot > 0 ? normalized.slice(0, dot) : normalized).trim();
}

/** Case and separators are what a camera or an operator varies freely. */
function looseCode(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The unit a filename most likely shows. A stem that matches a
 * code names it outright; otherwise a stem ending in a code after a separator
 * does, which is how `IMG_0413_T1-2` survives a camera.
 */
export function suggestUnit(
  filename: string,
  codes: readonly string[],
): string | null {
  const stem = looseCode(filenameStem(filename));
  if (!stem) return null;
  const exact = codes.filter((code) => looseCode(code) === stem);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const suffixed = codes.filter((code) => stem.endsWith(`-${looseCode(code)}`));
  if (suffixed.length !== 1) return null;
  return suffixed[0]!;
}
