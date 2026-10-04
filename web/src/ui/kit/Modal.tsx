import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { m } from "../../paraglide/messages";
import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";
import {
  DialogPresenceBackdrop,
  DialogPresenceRoot,
  useDialogPresence,
} from "./dialogPresence";
import { defaultPortalContainer } from "./floating";
import { panelTransition } from "./motionToken";

/*
 * `Modal` unmounts its root after the exit animation (see dialogPresence.tsx).
 * To ask before an action, call `confirmModal(...)`: it needs no React context
 * and is drawn by `<ModalHost />`, mounted once at the root.
 */

const modalMotionConfig = (): MotionProps => ({
  animate: { opacity: 1, scale: 1 },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: panelTransition("modal", "exit"),
  },
  initial: { opacity: 0, scale: 0.97 },
  transition: panelTransition("modal", "enter"),
});

const DENY_DURATION = 300;

/** Panel widths: `default` for a few fields, `wide` for tables and multi-column forms. */
export type ModalWidth = "default" | "wide";

const WIDTH = {
  default: undefined,
  wide: "ui-modal-popup-inner-wide",
} as const;

type ModalProps = {
  /** Called after the exit animation. */
  afterClose?: () => void;
  cancelButtonProps?: ButtonProps;
  children?: ReactNode;
  /** Spins the OK button. */
  confirmLoading?: boolean;
  /** Esc closes. */
  keyboard?: boolean;
  /** A backdrop click closes; when not allowed the panel shakes. */
  maskClosable?: boolean;
  /**
   * Props for the OK button. A form in the body is submitted from the footer
   * with `{ form: formId, htmlType: "submit" }`.
   */
  okButtonProps?: ButtonProps;
  /** Cancel, the close button, Esc and the backdrop all call it. */
  onCancel: () => void;
  open: boolean;
  title: ReactNode;
  width?: ModalWidth;
} & (
  | {
      /** Omitted: Cancel and OK. */
      footer?: undefined;
      okText: ReactNode;
    }
  | {
      /** The dialog's own buttons; `null` leaves the footer out. */
      footer: ReactNode;
      okText?: never;
    }
);

export function Modal({
  open,
  title,
  children,
  onCancel,
  okText,
  okButtonProps,
  cancelButtonProps,
  confirmLoading,
  footer,
  width = "default",
  maskClosable = true,
  keyboard = true,
  afterClose,
}: ModalProps) {
  const [isDenying, setIsDenying] = useState(false);
  const denyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(denyTimerRef.current), []);

  const triggerDeny = useCallback(() => {
    clearTimeout(denyTimerRef.current);
    setIsDenying(true);
    denyTimerRef.current = setTimeout(() => setIsDenying(false), DENY_DURATION);
  }, []);

  const footerNode =
    footer === undefined ? (
      <>
        <Button {...cancelButtonProps} onClick={onCancel}>
          {m.ui_cancel()}
        </Button>
        <Button loading={confirmLoading} type="primary" {...okButtonProps}>
          {okText}
        </Button>
      </>
    ) : (
      footer
    );

  return (
    <DialogPresenceRoot
      onExitComplete={afterClose}
      onOpenChange={(nextOpen, details) => {
        if (!open || nextOpen) return;
        if (!keyboard && details.reason === "escape-key") return;
        if (!maskClosable && details.reason === "outside-press") {
          triggerDeny();
          return;
        }
        onCancel();
      }}
      open={open}
    >
      <Dialog.Portal container={defaultPortalContainer()}>
        <DialogPresenceBackdrop className="ui-modal-backdrop" />
        <ModalPopup
          className={cn(WIDTH[width], isDenying && "ui-modal-deny-animation")}
        >
          <div className="ui-modal-header">
            <Dialog.Title className="ui-modal-title">{title}</Dialog.Title>
            <Dialog.Close aria-label={m.ui_close()} className="ui-modal-close">
              <X size={16} />
            </Dialog.Close>
          </div>
          {children != null && (
            <div className="ui-modal-content">{children}</div>
          )}
          {footerNode !== null && (
            <div className="ui-modal-footer">{footerNode}</div>
          )}
        </ModalPopup>
      </Dialog.Portal>
    </DialogPresenceRoot>
  );
}

/** The full-viewport popup and the panel centered in it. */
function ModalPopup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { onExitComplete, open } = useDialogPresence();
  return (
    <Dialog.Popup className="ui-modal-popup">
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <motion.div
            {...modalMotionConfig()}
            className={cn("ui-modal-popup-inner", className)}
            key="modal-popup-panel"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Dialog.Popup>
  );
}

interface ConfirmConfig {
  content?: ReactNode;
  /** Draws the OK button as destructive. */
  danger?: boolean;
  okText: ReactNode;
  /** Called when the reader cancels: Cancel, the close button, Esc or the backdrop. */
  onCancel?: () => void;
  /**
   * Returning a Promise spins the OK button and closes once it resolves; until
   * then the dialog cannot be dismissed. On rejection the dialog stays open and
   * the buttons are clickable again; the caller reports the error.
   */
  onOk: () => void | Promise<void>;
  title: ReactNode;
}

interface ConfirmEntry {
  config: ConfirmConfig;
  id: number;
  open: boolean;
}

/*
 * Closing first sets the entry's `open` to false; it leaves the list after its
 * exit animation. An entry closed before its dialog mounted has no animation to
 * wait for and leaves at once.
 */
let confirmStack: ConfirmEntry[] = [];
let confirmSeed = 0;
const mountedConfirms = new Set<number>();
const confirmListeners = new Set<() => void>();

function setConfirmStack(next: ConfirmEntry[]) {
  confirmStack = next;
  for (const listener of confirmListeners) listener();
}

const subscribeConfirms = (listener: () => void) => {
  confirmListeners.add(listener);
  return () => {
    confirmListeners.delete(listener);
  };
};

const NO_CONFIRMS: ConfirmEntry[] = [];

const closeConfirm = (id: number) =>
  setConfirmStack(
    mountedConfirms.has(id)
      ? confirmStack.map((entry) =>
          entry.id === id ? { ...entry, open: false } : entry,
        )
      : confirmStack.filter((entry) => entry.id !== id),
  );

/**
 * Asks for confirmation in a dialog with Cancel and OK. The backdrop, Esc, the
 * close button and Cancel all cancel, except while a returned Promise runs.
 * Returns a function that closes the dialog without an answer, for a question
 * that its caller can withdraw.
 */
export function confirmModal(config: ConfirmConfig): () => void {
  const id = confirmSeed++;
  setConfirmStack([...confirmStack, { config, id, open: true }]);
  return () => closeConfirm(id);
}

function ConfirmDialog({ entry }: { entry: ConfirmEntry }) {
  const { config, id, open } = entry;
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    mountedConfirms.add(id);
    return () => {
      mountedConfirms.delete(id);
    };
  }, [id]);
  const ok = async () => {
    try {
      const result = config.onOk();
      if (result) {
        setLoading(true);
        await result;
      }
    } catch {
      setLoading(false);
      return;
    }
    closeConfirm(id);
  };
  return (
    <Modal
      open={open}
      title={config.title}
      onCancel={
        loading
          ? () => {}
          : () => {
              closeConfirm(id);
              config.onCancel?.();
            }
      }
      keyboard={!loading}
      maskClosable={!loading}
      okText={config.okText}
      confirmLoading={loading}
      okButtonProps={{ danger: config.danger, onClick: () => void ok() }}
      cancelButtonProps={{ disabled: loading }}
      afterClose={() =>
        setConfirmStack(confirmStack.filter((item) => item.id !== id))
      }
    >
      {config.content}
    </Modal>
  );
}

/** Mount once at the app root. */
export function ModalHost() {
  const stack = useSyncExternalStore(
    subscribeConfirms,
    () => confirmStack,
    () => NO_CONFIRMS,
  );
  return stack.map((entry) => <ConfirmDialog entry={entry} key={entry.id} />);
}
