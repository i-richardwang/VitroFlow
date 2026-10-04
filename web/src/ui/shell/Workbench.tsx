import { PanelRight } from "lucide-react";
import {
  createContext,
  use,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "../kit/ActionIcon";
import { AppShellFlush } from "../kit/AppShell";
import { cn } from "../kit/cn";
import { DraggablePanel } from "../kit/DraggablePanel";
import { Drawer } from "../kit/Drawer";
import { Empty, type EmptyProps } from "../kit/Empty";
import { useIsCompact } from "../kit/mediaQuery";
import { Skeleton } from "../kit/Skeleton";
import { Toolbar } from "../kit/Toolbar";
import { ShellActions } from "./Shell";

/** Where floating content over the subject's top edge lands. */
const FloatSlots = createContext<{
  toolbar: HTMLElement | null;
  alert: HTMLElement | null;
} | null>(null);

const InspectorSlot = createContext<{
  node: HTMLElement | null;
  mount: () => () => void;
} | null>(null);

const INSPECTOR_WIDTH = { default: 300, min: 240, max: 480 };

/**
 * A page built around one framed subject. It fills the shell's card edge to
 * edge: the subject on the left with its controls and lasting notices
 * floating over its top edge, facts in an inspector panel on the right.
 * Actions belong in the shell's top bar. On narrow screens the inspector
 * moves into a drawer opened from the top bar.
 */
export function Workbench({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const compact = useIsCompact();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [alertSlot, setAlertSlot] = useState<HTMLDivElement | null>(null);
  const [inspectorNode, setInspectorNode] = useState<HTMLDivElement | null>(
    null,
  );
  const [inspectors, setInspectors] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inspector] = useState(() => ({
    mount: () => {
      setInspectors((count) => count + 1);
      return () => setInspectors((count) => count - 1);
    },
  }));
  const hasInspector = inspectors > 0;
  // The drawer pads its own body; the panel pads itself.
  const panel = (
    <div
      ref={setInspectorNode}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-6",
        !compact && "overflow-y-auto p-4",
      )}
    />
  );

  return (
    <FloatSlots value={{ toolbar: toolbarSlot, alert: alertSlot }}>
      <InspectorSlot value={{ node: inspectorNode, mount: inspector.mount }}>
        <h1 className="sr-only">{title}</h1>
        <AppShellFlush>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-container-secondary">
            <div className="pointer-events-none absolute inset-x-0 top-3 z-raise flex flex-col items-center gap-2 px-3">
              <div
                ref={setToolbarSlot}
                className="pointer-events-auto flex max-w-full items-center gap-2"
              />
              <div
                ref={setAlertSlot}
                className="pointer-events-auto w-full max-w-md empty:hidden"
              />
            </div>
            {children}
          </div>
          {hasInspector && !compact ? (
            <DraggablePanel
              aria-label={m.workbench_inspector()}
              defaultWidth={INSPECTOR_WIDTH.default}
              maxWidth={INSPECTOR_WIDTH.max}
              minWidth={INSPECTOR_WIDTH.min}
            >
              {panel}
            </DraggablePanel>
          ) : null}
        </AppShellFlush>
        {hasInspector && compact ? (
          <>
            <ShellActions>
              <ActionIcon
                icon={PanelRight}
                title={m.workbench_inspector()}
                onClick={() => setDrawerOpen(true)}
              />
            </ShellActions>
            <Drawer
              open={drawerOpen}
              title={m.workbench_inspector()}
              width={INSPECTOR_WIDTH.default}
              onClose={() => setDrawerOpen(false)}
            >
              {panel}
            </Drawer>
          </>
        ) : null}
      </InspectorSlot>
    </FloatSlots>
  );
}

/** Facts about the framed subject, shown in the workbench's inspector. */
export function WorkbenchInspector({ children }: { children: ReactNode }) {
  const slot = use(InspectorSlot);
  if (!slot) {
    throw new Error("WorkbenchInspector requires Workbench");
  }
  const { mount } = slot;
  useLayoutEffect(mount, [mount]);
  if (!slot.node) return null;
  return createPortal(children, slot.node);
}

/** A titled group of the inspector. */
export function WorkbenchSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Controls for the framed subject, floating over its top edge. */
export function WorkbenchToolbar({
  label,
  children,
  inert,
}: {
  label: string;
  children: ReactNode;
  inert?: boolean;
}) {
  const slot = use(FloatSlots)?.toolbar;
  if (!slot) return null;
  return createPortal(
    <Toolbar aria-label={label} inert={inert || undefined}>
      {children}
    </Toolbar>,
    slot,
  );
}

/** A state of the subject that lasts while it is open, floating under its toolbar. */
export function WorkbenchAlert({ children }: { children: ReactNode }) {
  const slot = use(FloatSlots)?.alert;
  if (!slot) return null;
  return createPortal(children, slot);
}

/** The subject's place when there is nothing to frame: what is missing and the way forward. */
export function WorkbenchEmpty(props: Omit<EmptyProps, "size">) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty size="large" {...props} />
    </div>
  );
}

const INSPECTOR_BONES = [
  ["40%", "88%", "72%"],
  ["32%", "64%", "80%", "56%"],
] as const;

/** The loading shape of a workbench: the framed subject and the inspector's groups. */
export function WorkbenchSkeleton() {
  return (
    <Workbench title={m.ui_page_loading()}>
      <ShellActions>
        <Skeleton.Button />
      </ShellActions>
      <WorkbenchInspector>
        {INSPECTOR_BONES.map((widths, index) => (
          <div aria-hidden key={index}>
            <Skeleton.Text size="lg" width={widths[0]} />
            <Skeleton.Text
              rows={widths.length - 1}
              width={[...widths.slice(1)]}
            />
          </div>
        ))}
      </WorkbenchInspector>
      <div
        aria-busy="true"
        className="flex min-h-0 flex-1 items-center justify-center p-12"
      >
        <output aria-live="polite" className="sr-only">
          {m.ui_page_loading()}
        </output>
        <Skeleton
          aria-hidden
          className="aspect-square max-w-full"
          width="auto"
          height="80%"
        />
      </div>
    </Workbench>
  );
}
