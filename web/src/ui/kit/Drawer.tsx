import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import type { ReactNode } from "react";
import { m } from "../../paraglide/messages";
import { cn } from "./cn";
import {
  DialogPresenceBackdrop,
  DialogPresenceRoot,
  useDialogPresence,
} from "./dialogPresence";
import { defaultPortalContainer } from "./floating";
import { panelTransition } from "./motionToken";

/*
 * A panel along the left or right edge. The root unmounts after the exit
 * animation (see dialogPresence.tsx). Backdrop and popup sit on the
 * `--z-index-popup` step and portal to `<body>`, so a later drawer covers an
 * earlier one by document order.
 */

type DrawerPlacement = "left" | "right";

const offscreen: Record<DrawerPlacement, { x: string }> = {
  left: { x: "-100%" },
  right: { x: "100%" },
};

const drawerMotionConfig = (placement: DrawerPlacement): MotionProps => ({
  animate: { x: 0 },
  exit: {
    ...offscreen[placement],
    transition: panelTransition("drawer", "exit"),
  },
  initial: offscreen[placement],
  transition: panelTransition("drawer", "enter"),
});

/** The edge panel; the popup clamps `width` to the viewport. */
function DrawerPopup({
  "aria-label": ariaLabel,
  children,
  placement,
  width,
}: {
  "aria-label"?: string;
  children: ReactNode;
  placement: DrawerPlacement;
  width: number;
}) {
  const { onExitComplete, open } = useDialogPresence();

  return (
    <Dialog.Popup
      aria-label={ariaLabel}
      className={cn("ui-drawer-popup", `ui-drawer-popup-${placement}`)}
      style={{ width }}
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <motion.div
            {...drawerMotionConfig(placement)}
            className={cn("ui-drawer-panel", `ui-drawer-panel-${placement}`)}
            key="drawer-popup-panel"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Dialog.Popup>
  );
}

interface DrawerProps {
  /** Names the dialog when `noHeader` leaves it without a title. */
  "aria-label"?: string;
  children: ReactNode;
  /** No header row; the close button floats at the top end. */
  noHeader?: boolean;
  onClose: () => void;
  open: boolean;
  placement?: DrawerPlacement;
  /** Names the dialog; required unless `noHeader`. */
  title?: ReactNode;
  /** In pixels. */
  width: number;
}

export function Drawer({
  "aria-label": ariaLabel,
  open,
  placement = "right",
  width,
  title,
  noHeader,
  onClose,
  children,
}: DrawerProps) {
  const closeNode = (
    <div
      className={cn("ui-drawer-extra", noHeader && "ui-drawer-extra-floating")}
    >
      <Dialog.Close aria-label={m.ui_close()} className="ui-drawer-close">
        <X size={16} />
      </Dialog.Close>
    </div>
  );

  return (
    <DialogPresenceRoot
      onOpenChange={(nextOpen) => {
        if (open && !nextOpen) onClose();
      }}
      open={open}
    >
      <Dialog.Portal container={defaultPortalContainer()}>
        <DialogPresenceBackdrop className="ui-drawer-backdrop" />
        <DrawerPopup
          aria-label={noHeader ? ariaLabel : undefined}
          placement={placement}
          width={width}
        >
          {noHeader ? (
            closeNode
          ) : (
            <div className="ui-drawer-header">
              <Dialog.Title className="ui-drawer-title">{title}</Dialog.Title>
              {closeNode}
            </div>
          )}
          <div className="ui-drawer-content">
            <div className="ui-drawer-body-content">{children}</div>
          </div>
        </DrawerPopup>
      </Dialog.Portal>
    </DialogPresenceRoot>
  );
}
