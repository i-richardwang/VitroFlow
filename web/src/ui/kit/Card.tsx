import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * A raised surface on the page that stacks its content with 16px padding,
 * optionally under a small title.
 */
export function Card({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("ui-card", className)}>
      {title ? <h3 className="ui-card-title">{title}</h3> : null}
      {children}
    </div>
  );
}
