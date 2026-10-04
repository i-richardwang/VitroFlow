import { cn } from "./cn";
import { Flexbox, type FlexboxProps } from "./Flex";

/* A surface: a Flexbox with a surface style. */

export interface BlockProps extends FlexboxProps {
  variant?: "filled" | "outlined";
}

export function Block({ className, variant = "filled", ...rest }: BlockProps) {
  return (
    <Flexbox
      className={cn("ui-block", `ui-block-${variant}`, className)}
      {...rest}
    />
  );
}
