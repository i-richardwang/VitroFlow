import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "./cn";

/*
 * A determinate bar. It draws the ratio only; the number is written next to
 * it. `small` is the thin track that sits under a figure or in a table cell.
 */

export function Progress({
  value,
  max,
  className,
  size = "middle",
  "aria-label": label,
}: {
  value: number;
  max: number;
  className?: string;
  size?: "small" | "middle";
  "aria-label": string;
}) {
  return (
    <BaseProgress.Root
      aria-label={label}
      className={cn(
        "ui-progress",
        size === "small" && "ui-progress-small",
        className,
      )}
      max={max}
      value={value}
    >
      <BaseProgress.Track className="ui-progress-track">
        <BaseProgress.Indicator className="ui-progress-indicator" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
