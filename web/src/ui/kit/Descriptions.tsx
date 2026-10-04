import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * An object's properties, one per row of at least 30px. By default labels
 * share a fixed column so stacked lists line up; `justified` sets each label
 * at the start and its value at the end in tabular figures, for a list of
 * numbers such as training parameters.
 */

export function Descriptions({
  children,
  justified,
}: {
  children: ReactNode;
  justified?: boolean;
}) {
  return (
    <dl
      className={cn(
        "ui-descriptions",
        justified && "ui-descriptions-justified",
      )}
    >
      {children}
    </dl>
  );
}

export function DescriptionsItem({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="ui-descriptions-label">{label}</dt>
      <dd className="ui-descriptions-value">{children}</dd>
    </>
  );
}
