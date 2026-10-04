import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * Loading placeholders. `Skeleton` is one block and the other shapes are
 * built from it. Each `Skeleton.Text` row takes exactly one line of text at a
 * type-scale `size`: the block is half the leading taller than the font, with
 * a quarter of the leading above and below, so nothing shifts when the real
 * text arrives. `Skeleton.Button` has the size of a middle Button.
 */

type Length = number | string;

export interface SkeletonProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  height?: Length;
  width?: Length;
}

function SkeletonRoot({
  width = "100%",
  height = "1em",
  className,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <div
      className={cn("ui-skeleton", className)}
      style={{ height, width, ...style }}
      {...rest}
    />
  );
}

const LINE_HEIGHT = 1.6;

function SkeletonText({
  rows = 1,
  size = "base",
  width,
}: {
  size?: "xs" | "sm" | "base" | "lg";
  rows?: number;
  /** One width for every row, or one per row (the last repeats). */
  width: Length | Length[];
}) {
  const base = `var(--text-${size})`;
  const rowHeight = `round(calc(${base} * ${1 + (LINE_HEIGHT - 1) * 0.5}), 1px)`;
  const halfLeading = `round(calc(${base} * ${(LINE_HEIGHT - 1) * 0.25}), 1px)`;
  const widths = Array.isArray(width) ? width : [width];

  return (
    <div className="ui-skeleton-text">
      {Array.from({ length: Math.max(rows, 1) }).map((_, index) => (
        <SkeletonRoot
          height={rowHeight}
          key={index}
          style={{ marginBlock: halfLeading }}
          width={widths[index] ?? widths.at(-1)}
        />
      ))}
    </div>
  );
}

function SkeletonButton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("ui-skeleton ui-skeleton-button", className)}
    />
  );
}

export const Skeleton = Object.assign(SkeletonRoot, {
  Button: SkeletonButton,
  Text: SkeletonText,
});
