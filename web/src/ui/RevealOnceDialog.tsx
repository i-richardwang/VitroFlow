import { useState, type ReactNode } from "react";

import { m } from "../paraglide/messages";
import { Alert } from "./kit/Alert";
import { Button } from "./kit/Button";
import { Flexbox } from "./kit/Flex";
import { Modal } from "./kit/Modal";

/**
 * Shows a secret the server hands out only once, such as a new key or token.
 * It opens while `revealed` holds a value and keeps drawing that value through
 * the exit animation. Only Close, Esc or the close button dismiss it, so a
 * stray click on the backdrop cannot lose the secret.
 */
export function RevealOnceDialog<T>({
  revealed,
  onClose,
  title,
  warning,
  children,
}: {
  revealed: T | null;
  onClose: () => void;
  title: ReactNode;
  warning: ReactNode;
  children: (revealed: T) => ReactNode;
}) {
  const [shown, setShown] = useState(revealed);
  if (revealed !== null && revealed !== shown) setShown(revealed);
  if (shown === null) return null;
  return (
    <Modal
      open={revealed !== null}
      title={title}
      width="wide"
      maskClosable={false}
      onCancel={onClose}
      afterClose={() => setShown(null)}
      footer={
        <Button type="primary" onClick={onClose}>
          {m.ui_close()}
        </Button>
      }
    >
      <Flexbox>
        <Alert type="warning" title={warning} />
        {children(shown)}
      </Flexbox>
    </Modal>
  );
}
