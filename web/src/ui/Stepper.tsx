import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ActionIcon } from "./kit/ActionIcon";
import { Text } from "./kit/Text";

/** One way through a sequence; without `onClick` there is nothing further that way. */
interface Step {
  label: string;
  onClick?: () => void;
}

/** Where a sequence stands, such as images or units, between the steps back and forward through it. */
export function Stepper({
  previous,
  next,
  children,
}: {
  previous: Step;
  next: Step;
  children: ReactNode;
}) {
  return (
    <span className="flex flex-none items-center gap-1">
      <StepButton icon={ChevronLeft} step={previous} />
      <Text as="span" size="sm" className="whitespace-nowrap tabular-nums">
        {children}
      </Text>
      <StepButton icon={ChevronRight} step={next} />
    </span>
  );
}

function StepButton({ icon, step }: { icon: LucideIcon; step: Step }) {
  return (
    <ActionIcon
      icon={icon}
      size="small"
      title={step.label}
      tooltipProps={{ placement: "bottom" }}
      disabled={!step.onClick}
      onClick={step.onClick}
    />
  );
}
