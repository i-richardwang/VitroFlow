import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

/*
 * A state as a mark and a word in the tone's color: the mark is `icon` at 12
 * pixels when given, a 6-pixel dot otherwise. `spin` turns the icon for work
 * in progress. Other props reach the span, so it can be a tooltip trigger.
 *
 * `StatusDot` is the mark alone, set right after a name: an 8-pixel dot in a
 * 3-pixel halo of its tone, or a hollow ring for `neutral`. Its `label` is the
 * word, read out and shown on hover.
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

const TONE = {
  neutral: "ui-status-neutral",
  info: "ui-status-info",
  success: "ui-status-success",
  warning: "ui-status-warning",
  error: "ui-status-error",
} satisfies Record<StatusTone, string>;

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
    <span {...props} className={cn("ui-status", TONE[tone], className)}>
      {icon ? (
        <Icon icon={icon} size={12} spin={spin} />
      ) : (
        <span aria-hidden className="ui-status-dot" />
      )}
      {children}
    </span>
  );
}

const DOT_TONE = {
  neutral: "ui-status-dot-neutral",
  info: "ui-status-dot-info",
  success: "ui-status-dot-success",
  warning: "ui-status-dot-warning",
  error: "ui-status-dot-error",
} satisfies Record<StatusTone, string>;

export function StatusDot({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}) {
  return (
    <span
      className={cn("ui-status-dot-mark", DOT_TONE[tone])}
      role="img"
      title={label}
    />
  );
}
