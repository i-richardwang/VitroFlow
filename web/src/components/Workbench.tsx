import { Card } from "@heroui/react";
import type { ReactNode } from "react";

import { ShellActions, ShellAside } from "./shell";

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
      {inspector ? <ShellAside>{inspector}</ShellAside> : null}
      {actions ? <ShellActions>{actions}</ShellActions> : null}
      <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-secondary p-6">
        <Card className="relative flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden p-0">
          {toolbar ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
              <div className="pointer-events-auto max-w-full">{toolbar}</div>
            </div>
          ) : null}
          {children}
        </Card>
      </div>
    </>
  );
}
