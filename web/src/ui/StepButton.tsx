import { ChevronLeft, ChevronRight } from "lucide-react";

import { ActionIcon } from "./kit/ActionIcon";

/** One step backward or forward through a sequence, such as images or units. */
export function StepButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ActionIcon
      icon={direction === "previous" ? ChevronLeft : ChevronRight}
      size="small"
      title={label}
      tooltipProps={{ placement: "bottom" }}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
