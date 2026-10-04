import { useEffect, useRef } from "react";
import { m } from "../../paraglide/messages";
import { confirmDestructive } from "../../ui/confirmDestructive";

/**
 * Asks before leaving a draft with unsaved changes. The question is open
 * exactly while a navigation waits on it: every way of dismissing it stays and
 * cancels the navigation, leaving lets it proceed, and saving withdraws it.
 */
export function DiscardDraftDialog({
  discard,
}: {
  discard: { onStay: () => void; onLeave: () => void } | null;
}) {
  // The answers read the latest callbacks; the question opens once per block.
  const latest = useRef(discard);
  useEffect(() => {
    latest.current = discard;
  });

  const blocked = discard !== null;
  useEffect(() => {
    if (!blocked) return;
    return confirmDestructive({
      title: m.calibration_discard_confirm(),
      content: m.calibration_discard_description(),
      confirmLabel: m.calibration_discard(),
      onConfirm: () => latest.current?.onLeave(),
      onCancel: () => latest.current?.onStay(),
    });
  }, [blocked]);

  return null;
}
