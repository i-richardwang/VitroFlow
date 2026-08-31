/** Roster order: numbers inside labels compare by value, so `A2` precedes `A10`. */
export function compareDishLabels(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

/**
 * Roster order: the design's treatments in their own order, each followed by
 * its replicates, with the dishes no treatment claims last. This is the order
 * the grid shows and the order the dish pages step through.
 */
export function rosterOrder<
  Dish extends { label: string; treatment: string | null },
>(
  dishes: readonly Dish[],
  treatments: readonly { id: string; position: number }[],
): Dish[] {
  const rank = new Map(treatments.map((item) => [item.id, item.position]));
  const group = (dish: Dish) =>
    dish.treatment === null
      ? Number.MAX_SAFE_INTEGER
      : (rank.get(dish.treatment) ?? Number.MAX_SAFE_INTEGER);
  return [...dishes].sort(
    (left, right) =>
      group(left) - group(right) || compareDishLabels(left.label, right.label),
  );
}

/**
 * The labels a treatment's replicates take: `T1-1` through `T1-n`, skipping
 * any the experiment already uses so that adding replicates continues the
 * series instead of colliding with it.
 */
export function replicateLabels(
  treatment: string,
  replicates: number,
  taken: readonly string[],
): string[] {
  const used = new Set(taken.map(dishLabelKey));
  const labels: string[] = [];
  for (let replicate = 1; labels.length < replicates; replicate += 1) {
    const label = `${treatment}-${replicate}`;
    if (used.has(dishLabelKey(label))) continue;
    used.add(dishLabelKey(label));
    labels.push(label);
  }
  return labels;
}

/**
 * Labels compare by what a person sees: case, accent composition, and the
 * separator between a treatment and its replicate are not distinctions.
 */
export function dishLabelKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The filename without its extension, as the camera or the operator wrote it. */
export function filenameStem(filename: string): string {
  const normalized = filename.normalize("NFC").trim();
  const dot = normalized.lastIndexOf(".");
  return (dot > 0 ? normalized.slice(0, dot) : normalized).trim();
}

/**
 * The dish a filename most likely shows. A stem that normalizes to a label
 * names it outright; otherwise a stem ending in a label after a separator
 * does, which is how `IMG_0413_T1-2` survives a camera. A stem that fits
 * more than one dish names none, and is left to the operator.
 */
export function suggestDish(
  filename: string,
  labels: readonly string[],
): string | null {
  const stem = dishLabelKey(filenameStem(filename));
  if (!stem) return null;
  const exact = labels.filter((label) => dishLabelKey(label) === stem);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const suffixed = labels.filter((label) =>
    stem.endsWith(`-${dishLabelKey(label)}`),
  );
  if (suffixed.length !== 1) return null;
  return suffixed[0]!;
}
