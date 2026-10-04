import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/*
 * Body text in the text color, rendered as a `div` unless `as` says otherwise.
 * `disabled` draws it in the tertiary text color, as the label of a disabled
 * control; `ellipsis` cuts the text to one line.
 */

export interface TextProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  disabled?: boolean;
  ellipsis?: boolean;
}

export function Text({
  as: Container = "div",
  children,
  className,
  disabled,
  ellipsis,
  ...rest
}: TextProps): ReactNode {
  return (
    <Container
      {...rest}
      className={cn(
        "ui-text",
        ellipsis && "ui-text-ellipsis",
        disabled && "ui-text-disabled",
        className,
      )}
    >
      {children}
    </Container>
  );
}
