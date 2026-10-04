import { m } from "../../paraglide/messages";
import { Modal } from "../../ui/kit/Modal";

/**
 * Asks before leaving a draft with unsaved changes. It is open exactly while
 * a navigation waits on it: every way of dismissing it stays and cancels the
 * navigation, leaving lets it proceed, and saving closes it.
 */
export function DiscardDraftDialog({
  discard,
}: {
  discard: { onStay: () => void; onLeave: () => void } | null;
}) {
  return (
    <Modal
      open={discard !== null}
      title={m.calibration_discard_confirm()}
      onCancel={() => discard?.onStay()}
      okText={m.calibration_discard()}
      okButtonProps={{ danger: true, onClick: () => discard?.onLeave() }}
    >
      {m.calibration_discard_description()}
    </Modal>
  );
}
