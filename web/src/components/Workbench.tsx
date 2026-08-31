import { Sheet } from "@heroui-pro/react/sheet";
import { Button, Card, Tooltip } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";

import { PanelRightIcon } from "./icons";
import { ShellActions } from "./shell";

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
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setInspectorOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {actions || inspector ? (
        <ShellActions>
          {inspector ? (
            <Tooltip delay={0}>
              <Button
                variant="ghost"
                isIconOnly
                className="md:hidden"
                aria-label="Details"
                onPress={() => setInspectorOpen(true)}
              >
                <PanelRightIcon />
              </Button>
              <Tooltip.Content>Details</Tooltip.Content>
            </Tooltip>
          ) : null}
          {actions}
        </ShellActions>
      ) : null}
      <div className="flex h-full min-h-0 flex-1 flex-col p-3 md:p-6">
        {toolbar ? <div className="mb-4 shrink-0">{toolbar}</div> : null}
        <div className="flex min-h-0 flex-1 items-start gap-6">
          <Card
            variant="secondary"
            className="min-h-0 min-w-0 flex-1 self-stretch overflow-hidden p-0"
          >
            {children}
          </Card>
          {inspector ? (
            <Card className="hidden max-h-full w-80 shrink-0 gap-6 overflow-y-auto text-sm md:flex">
              {inspector}
            </Card>
          ) : null}
        </div>
      </div>
      {inspector ? (
        <Sheet
          isOpen={inspectorOpen}
          placement="right"
          onOpenChange={setInspectorOpen}
        >
          <Sheet.Backdrop variant="blur">
            <Sheet.Content className="w-full max-w-sm">
              <Sheet.Dialog className="h-dvh">
                <Sheet.Header>
                  <Sheet.Heading>Details</Sheet.Heading>
                  <Sheet.CloseTrigger />
                </Sheet.Header>
                <Sheet.Body className="flex flex-col gap-6 text-sm">
                  {inspector}
                </Sheet.Body>
              </Sheet.Dialog>
            </Sheet.Content>
          </Sheet.Backdrop>
        </Sheet>
      ) : null}
    </>
  );
}
