import { type LucideIcon, TriangleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

/* An inline notice: a title, an optional description line under it, and an optional action. */

export type AlertType = "warning" | "error";

export interface AlertProps {
  /** Placed after the text. */
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  type: AlertType;
}

const TYPE_ICONS = {
  error: XCircle,
  warning: TriangleAlert,
} satisfies Record<AlertType, LucideIcon>;

export function Alert({ action, description, title, type }: AlertProps) {
  const hasDescription = description !== undefined && description !== null;
  return (
    <div
      className={cn(
        `ui-alert-tone-${type}`,
        "ui-alert",
        hasDescription ? "ui-alert-detailed" : "ui-alert-centered",
      )}
      role="alert"
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
