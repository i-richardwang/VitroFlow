import { AppLayout } from "@heroui-pro/react/app-layout";
import type { ReactNode } from "react";

import { ShellActions, ShellAside, ShellToolbar } from "./shell";

export function Workbench({
  title,
  actions,
  toolbar,
  inspector,
  children,
}: {
  title: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {toolbar ? <ShellToolbar>{toolbar}</ShellToolbar> : null}
      {inspector ? <ShellAside>{inspector}</ShellAside> : null}
      {actions || inspector ? (
        <ShellActions>
          {inspector ? (
            <AppLayout.AsideTrigger
              closedTooltip="Details"
              openTooltip="Hide details"
            />
          ) : null}
          {actions}
        </ShellActions>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  );
}
