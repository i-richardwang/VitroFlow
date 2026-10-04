import type { ReactNode } from "react";

import { m } from "../paraglide/messages";
import { errorMessage } from "./errors";
import { confirmModal } from "./kit/Modal";
import { toast } from "./kit/Toast";

/**
 * Asks before an irreversible action. The dialog stays open while the action
 * runs and after it fails, so the reader can retry or cancel; `onCancel`
 * hears every way of dismissing it. The returned function withdraws the
 * question unanswered.
 */
export function confirmDestructive({
  title,
  content,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  content?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}): () => void {
  return confirmModal({
    title,
    content,
    okText: confirmLabel,
    danger: true,
    onOk: () =>
      onConfirm()?.catch((error: unknown) => {
        toast.error({
          title: m.action_failed({ action: confirmLabel }),
          description: errorMessage(error),
        });
        throw error;
      }),
    onCancel,
  });
}
