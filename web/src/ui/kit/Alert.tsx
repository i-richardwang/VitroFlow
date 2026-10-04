import { type LucideIcon, TriangleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

/*
 * An inline notice of a lasting state: a title, an optional description line
 * under it, and an optional action. It is a polite live region, so a notice
 * that appears is announced without interrupting.
 */

export type AlertType = "warning" | "error";

export interface AlertProps {
  /** Placed after the text. */
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  type: AlertType;
}

const TONE = {
  error: "ui-alert-tone-error",
  warning: "ui-alert-tone-warning",
} satisfies Record<AlertType, string>;

const TYPE_ICONS = {
  error: XCircle,
  warning: TriangleAlert,
} satisfies Record<AlertType, LucideIcon>;

export function Alert({ action, description, title, type }: AlertProps) {
  const hasDescription = description !== undefined && description !== null;
  return (
    <div
      className={cn(
        TONE[type],
        "ui-alert",
        hasDescription ? "ui-alert-detailed" : "ui-alert-centered",
      )}
      role="status"
    >
      <span aria-hidden="true" className="ui-alert-icon">
        <Icon icon={TYPE_ICONS[type]} size={hasDescription ? 18 : 16} />
      </span>
      <div className="ui-alert-content">
        <div className="ui-alert-title">{title}</div>
        {hasDescription && (
          <div className="ui-alert-description">{description}</div>
        )}
      </div>
      {action && <div className="ui-alert-action">{action}</div>}
    </div>
  );
}
