import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * A surface on the page that stacks its content with 16px padding, optionally
 * under a small title. `outlined` (the default) is the container color inside
 * a thin border; `filled` is a band of fill one step heavier, for the figure a
 * page leads with.
 */
export function Card({
  children,
  className,
  title,
  variant = "outlined",
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  variant?: "outlined" | "filled";
}) {
  return (
    <div
      className={cn(
        "ui-card",
        variant === "filled" ? "ui-card-filled" : "ui-card-outlined",
        className,
      )}
    >
      {title ? <h3 className="ui-card-title">{title}</h3> : null}
      {children}
    </div>
  );
}
