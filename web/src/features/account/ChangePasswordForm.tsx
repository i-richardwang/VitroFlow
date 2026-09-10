import { Button, Form, toast } from "@heroui/react";
import { useState } from "react";

import { authClient } from "../../features/account/client";
import { PasswordField } from "../../features/users/PasswordField";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { m } from "../../paraglide/messages";

export function ChangePasswordForm() {
  const { busy, run } = useAsyncAction();
  const [mismatch, setMismatch] = useState(false);
  return (
    <Form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
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
          form.reset();
          toast.success(m.account_password_changed());
        });
      }}
    >
      <PasswordField
        label={m.account_current_password()}
        name="currentPassword"
        autoComplete="current-password"
        isDisabled={busy}
      />
      <PasswordField
        label={m.account_new_password()}
        name="newPassword"
        isDisabled={busy}
      />
      <PasswordField
        label={m.account_confirm_password()}
        name="confirmation"
        isDisabled={busy}
        isInvalid={mismatch}
        errorMessage={mismatch ? m.account_password_mismatch() : undefined}
      />
      <Button
        type="submit"
        variant="primary"
        className="self-start"
        isDisabled={busy}
      >
        {busy ? m.account_changing_password() : m.account_change_password()}
      </Button>
    </Form>
  );
}
