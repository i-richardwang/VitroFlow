import { useState } from "react";

import { authClient } from "./client";
import { PasswordField } from "../users/PasswordField";
import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { Form } from "../../ui/kit/Form";
import { toast } from "../../ui/kit/Toast";

const FORM_ID = "change-password";

/** The signed-in reader's password change; other sessions are signed out. */
export function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.account_change_password()}
      okText={m.account_change_password()}
      formId={FORM_ID}
      busy={action.busy}
    >
      <ChangePasswordForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

function ChangePasswordForm({
  action: { busy, run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const [mismatch, setMismatch] = useState(false);

  return (
    <Form
      id={FORM_ID}
      errors={
        mismatch ? { confirmation: m.account_password_mismatch() } : undefined
      }
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const currentPassword = String(values.get("currentPassword") ?? "");
        const newPassword = String(values.get("newPassword") ?? "");
        const confirmation = String(values.get("confirmation") ?? "");
        if (newPassword !== confirmation) {
          setMismatch(true);
          return;
        }
        setMismatch(false);
        void run(async () => {
          const { error } = await authClient.changePassword({
            currentPassword,
            newPassword,
            revokeOtherSessions: true,
          });
          if (error) throw new Error(error.message);
        }, m.account_password_not_changed()).then((result) => {
          if (!result.ok) return;
          toast.success(m.account_password_changed());
          onDone();
        });
      }}
    >
      <PasswordField
        label={m.account_current_password()}
        name="currentPassword"
        autoComplete="current-password"
        autoFocus
        disabled={busy}
      />
      <PasswordField
        label={m.account_new_password()}
        name="newPassword"
        disabled={busy}
      />
      <PasswordField
        label={m.account_confirm_password()}
        name="confirmation"
        disabled={busy}
      />
    </Form>
  );
}
