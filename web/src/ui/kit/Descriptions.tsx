import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * An object's properties in a label column and a value column. The label
 * column fits the longest label; `aligned` lists share one fixed label width
 * so stacked or side-by-side lists line up.
 */

export function Descriptions({
  aligned,
  children,
}: {
  aligned?: boolean;
  children: ReactNode;
}) {
  return (
    <dl className={cn("ui-descriptions", aligned && "ui-descriptions-aligned")}>
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
