import { AlertDialog, Button } from "@heroui/react";
import { type ReactNode, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { m } from "../paraglide/messages";

export function DestructiveActionDialog({
  isOpen,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const { busy, run } = useAsyncAction();

  return (
    <AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            {children ? <AlertDialog.Body>{children}</AlertDialog.Body> : null}
            <AlertDialog.Footer>
              <Button variant="tertiary" slot="close" isDisabled={busy}>
                {m.cancel()}
              </Button>
              <Button
                variant="danger"
                isDisabled={busy}
                onPress={() => {
                  void run(
                    onConfirm,
                    m.action_failed({ action: confirmLabel }),
                  ).then((result) => {
                    if (result.ok) onOpenChange(false);
                  });
                }}
              >
                {busy
                  ? m.action_in_progress({ action: confirmLabel })
                  : confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/** A button that asks before it acts. */
export function DestructiveActionButton({
  label,
  title,
  confirmLabel,
  onConfirm,
  children,
}: {
  label: string;
  title: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={title}
        onPress={() => setOpen(true)}
      >
        {m.action_in_progress({ action: label })}
      </Button>
      <DestructiveActionDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        confirmLabel={confirmLabel}
        onConfirm={onConfirm}
      >
        {children}
      </DestructiveActionDialog>
    </>
  );
}
