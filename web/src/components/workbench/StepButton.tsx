import { Button, Tooltip } from "@heroui/react";
import type { ReactNode } from "react";

/** Moves to the neighbouring record; disabled at either end of the series. */
export function StepButton({
  label,
  neighbour,
  onPress,
  children,
}: {
  label: string;
  neighbour: string | null;
  onPress: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      variant="tertiary"
      isIconOnly
      aria-label={label}
      isDisabled={neighbour === null}
      onPress={onPress}
    >
      {children}
    </Button>
  );
  if (neighbour === null) return button;
  return (
    <Tooltip delay={0}>
      {button}
      <Tooltip.Content className="font-mono">{neighbour}</Tooltip.Content>
    </Tooltip>
  );
}
