import type { Correction } from "../schemas";

function describe(correction: Correction): string {
  switch (correction.type) {
    case "remove":
      return `Remove #${correction.id}`;
    case "add":
      return `Add at ${correction.point.x.toFixed(0)}, ${correction.point.y.toFixed(0)}`;
    case "merge":
      return `Merge ${correction.ids.map((id) => `#${id}`).join(" ")}`;
    case "split":
      return `Split #${correction.id} into ${correction.points.length}`;
  }
}

export function CorrectionsList({
  corrections,
  onRevert,
}: {
  corrections: Correction[];
  onRevert: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-neutral-400">
        Click a detection to remove it, ⌥-click to split it, drag it onto
        another to merge. Click bare image to add a seed. Click any correction
        to revert it.
      </p>
      {corrections.length > 0 && (
        <ul className="divide-y divide-neutral-100 text-xs">
          {corrections.map((correction, index) => (
            <li
              key={index}
              className="flex items-center justify-between py-1.5"
            >
              <span className="font-mono">{describe(correction)}</span>
              <button
                type="button"
                onClick={() => onRevert(index)}
                className="text-neutral-400 hover:text-neutral-900"
              >
                Revert
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
