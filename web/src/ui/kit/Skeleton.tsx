import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * Loading placeholders. `Skeleton` is one block and the other shapes are
 * built from it. Each `Skeleton.Text` row takes exactly one line box of text
 * at a type-scale `size`, read from that step's font size and line height:
 * a quarter of the leading above and below, the block filling the rest, so
 * nothing shifts when the real text arrives. `Skeleton.Button` has the size
 * of a middle Button.
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

const LINE_SIZE = {
  xs: "ui-skeleton-line-xs",
  sm: "ui-skeleton-line-sm",
  base: "ui-skeleton-line-base",
  lg: "ui-skeleton-line-lg",
} as const;

function SkeletonText({
  rows = 1,
  size = "base",
  width,
}: {
  size?: keyof typeof LINE_SIZE;
  rows?: number;
  /** One width for every row, or one per row (the last repeats). */
  width: Length | Length[];
}) {
  const widths = Array.isArray(width) ? width : [width];

  return (
    <div className="ui-skeleton-text">
      {Array.from({ length: Math.max(rows, 1) }).map((_, index) => (
        <div
          className={cn("ui-skeleton ui-skeleton-line", LINE_SIZE[size])}
          key={index}
          style={{ width: widths[index] ?? widths.at(-1) }}
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
