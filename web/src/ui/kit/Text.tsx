import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/*
 * Body text in the text color, rendered as a `div` unless `as` says otherwise.
 * `type="secondary"` is description text, drawn in the tertiary text color;
 * `ellipsis` cuts the text to one line.
 */

export interface TextProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  code?: boolean;
  ellipsis?: boolean;
  type?: "secondary" | "danger";
}

const TYPE_CLASS = {
  danger: "ui-text-danger",
  secondary: "ui-text-secondary",
} as const;

export function Text({
  as: Container = "div",
  children,
  className,
  code,
  ellipsis,
  type,
  ...rest
}: TextProps): ReactNode {
  return (
    <Container
      {...rest}
      className={cn(
        "ui-text",
        code && "ui-text-code",
        ellipsis && "ui-text-ellipsis",
        type && TYPE_CLASS[type],
        className,
      )}
    >
      {children}
    </Container>
  );
}
