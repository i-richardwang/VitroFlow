import { Tooltip } from "@heroui/react";
import type { ReactNode } from "react";

export function Hint({
  children,
  text,
}: {
  children: ReactNode;
  text?: string | null;
}) {
  if (!text) {
    return children;
  }
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger className="inline-flex shrink-0">
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-xs">{text}</Tooltip.Content>
    </Tooltip>
  );
}
