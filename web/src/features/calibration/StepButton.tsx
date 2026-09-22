import { Button } from "@heroui/react";
import type { ReactNode } from "react";

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
  return (
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
}
