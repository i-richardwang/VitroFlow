import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  UNCLEAR_NOTE_LENGTH,
  type UnclearMark,
} from "../../domain/images/unclear";
import { markUnclear } from "../../functions/images";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  useAsyncAction,
  type AsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Checkbox } from "../../ui/kit/Checkbox";
import { Form } from "../../ui/kit/Form";
import { TextArea } from "../../ui/kit/Input";
import { toast } from "../../ui/kit/Toast";

const FORM_ID = "mark-unclear";

/**
 * Marks the photograph on view unclear, or edits the mark it has: whether it
 * is counted anyway, not by default, and a note on what makes it unclear.
 */
export function UnclearDialog({
  digest,
  filename,
  mark,
  open,
  onClose,
}: {
  digest: string;
  /** The file the photograph was taken as, naming it in the dialog. */
  filename: string;
  mark: UnclearMark | null;
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        mark
          ? m.unclear_dialog_edit_title({ file: filename })
          : m.unclear_dialog_title({ file: filename })
      }
      okText={m.unclear_dialog_save()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <UnclearForm
        digest={digest}
        filename={filename}
        mark={mark}
        action={action}
        onDone={onClose}
      />
    </FormDialog>
  );
}

function UnclearForm({
  digest,
  filename,
  mark,
  action,
  onDone,
}: {
  digest: string;
  filename: string;
  mark: UnclearMark | null;
  action: AsyncAction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [counted, setCounted] = useState(mark?.counted ?? false);
  const [note, setNote] = useState(mark?.note ?? "");
  return (
    <Form
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run(
            () => markUnclear({ data: { digest, counted, note: note.trim() } }),
            m.unclear_not_saved(),
          )
          .then(async (result) => {
            if (!result.ok) return;
            toast.success(m.unclear_marked({ file: filename }));
            onDone();
            await router.invalidate();
          });
      }}
    >
      <Checkbox checked={counted} disabled={action.busy} onChange={setCounted}>
        {m.unclear_counted_label()}
      </Checkbox>
      <Form.Field label={m.unclear_note_label()}>
        <TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={action.busy}
          maxLength={UNCLEAR_NOTE_LENGTH}
          placeholder={m.unclear_note_placeholder()}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Form.Field>
    </Form>
  );
}
