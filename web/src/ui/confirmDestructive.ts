import type { ReactNode } from "react";

import { m } from "../paraglide/messages";
import { errorMessage } from "./errors";
import { confirmModal } from "./kit/Modal";
import { toast } from "./kit/Toast";

/**
 * Asks before an irreversible action. The dialog stays open while the action
 * runs and after it fails, so the reader can retry or cancel.
 */
export function confirmDestructive({
  title,
  content,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  content?: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  confirmModal({
    title,
    content,
    okText: confirmLabel,
    danger: true,
    onOk: () =>
      onConfirm().catch((error: unknown) => {
        toast.error({
          title: m.action_failed({ action: confirmLabel }),
          description: errorMessage(error),
        });
        throw error;
      }),
  });
}
