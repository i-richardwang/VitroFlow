import { AlertDialog, Button } from "@heroui/react";
import type { ReactNode } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";

export function DeleteDialog({
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
                Cancel
              </Button>
              <Button
                variant="danger"
                isDisabled={busy}
                onPress={() => {
                  void run(onConfirm, `${confirmLabel} failed`).then(
                    (result) => {
                      if (result.ok) onOpenChange(false);
                    },
                  );
                }}
              >
                {busy ? `${confirmLabel}…` : confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
