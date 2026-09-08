import { Card, Toolbar } from "@heroui/react";
import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ShellActions, ShellAside } from "./shell";

const ToolbarSlot = createContext<HTMLElement | null>(null);

/**
 * A page built around one framed subject. Actions belong in the navbar,
 * facts in the inspector aside, and controls for the frame in the toolbar
 * over it. The workbench fills those slots for as long as it is shown.
 */
export function Workbench({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  return (
    <ToolbarSlot value={toolbarSlot}>
      <h1 className="sr-only">{title}</h1>
      <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-secondary p-6">
        <Card className="relative flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden p-0">
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
            <div
              ref={setToolbarSlot}
              className="pointer-events-auto max-w-full"
            />
          </div>
          {children}
        </Card>
      </div>
    </ToolbarSlot>
  );
}

export { ShellActions as WorkbenchActions, ShellAside as WorkbenchInspector };

export function WorkbenchToolbar({
  label,
  children,
  inert,
}: {
  label: string;
  children: ReactNode;
  inert?: boolean;
}) {
  const slot = use(ToolbarSlot);
  if (!slot) return null;
  return createPortal(
    <Toolbar isAttached aria-label={label} inert={inert || undefined}>
      {children}
    </Toolbar>,
    slot,
  );
}
