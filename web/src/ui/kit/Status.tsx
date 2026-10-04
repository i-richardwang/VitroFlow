import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

/*
 * A state as a mark and a word in the tone's color: the mark is `icon` at 12
 * pixels when given, a 6-pixel dot otherwise. `spin` turns the icon for work
 * in progress. Other props reach the span, so it can be a tooltip trigger.
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

export interface StatusProps extends ComponentProps<"span"> {
  icon?: LucideIcon;
  spin?: boolean;
  tone: StatusTone;
}

export function Status({
  children,
  className,
  icon,
  spin,
  tone,
  ...props
}: StatusProps) {
  return (
    <span
      {...props}
      className={cn("ui-status", `ui-status-${tone}`, className)}
    >
      {icon ? (
        <Icon icon={icon} size={12} spin={spin} />
      ) : (
        <span aria-hidden className="ui-status-dot" />
      )}
      {children}
    </span>
  );
}
