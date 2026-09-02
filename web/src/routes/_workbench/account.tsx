import { Widget } from "@heroui-pro/react/widget";
import { Button, Form, toast } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "../../auth/client";
import { Page } from "../../components/Page";
import { PasswordField } from "../../components/users/PasswordField";
import { useAsyncAction } from "../../hooks/useAsyncAction";

export const Route = createFileRoute("/_workbench/account")({
  staticData: { crumbs: [{ label: "Account" }] },
  head: () => ({ meta: [{ title: "Account · VitroFlow" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { user } = Route.useRouteContext();
  const { busy, run } = useAsyncAction();
  const [mismatch, setMismatch] = useState(false);

  return (
    <Page title="Account" description={`${user.name} · ${user.email}`}>
      <Widget>
        <Widget.Header>
          <Widget.Title>Change password</Widget.Title>
          <Widget.Description>
            Changing your password signs out every other browser session.
          </Widget.Description>
        </Widget.Header>
        <Widget.Content>
          <Form
            className="flex max-w-md flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const currentPassword = String(
                values.get("currentPassword") ?? "",
              );
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
              }, "Password not changed").then((result) => {
                if (!result.ok) return;
                form.reset();
                toast.success("Password changed");
              });
            }}
          >
            <PasswordField
              label="Current password"
              name="currentPassword"
              autoComplete="current-password"
              isDisabled={busy}
            />
            <PasswordField
              label="New password"
              name="newPassword"
              isDisabled={busy}
            />
            <PasswordField
              label="Confirm new password"
              name="confirmation"
              isDisabled={busy}
              isInvalid={mismatch}
              errorMessage={mismatch ? "Passwords do not match." : undefined}
            />
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              isDisabled={busy}
            >
              {busy ? "Changing…" : "Change password"}
            </Button>
          </Form>
        </Widget.Content>
      </Widget>
    </Page>
  );
}
