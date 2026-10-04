import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ChangePasswordDialog } from "../../features/account/ChangePasswordDialog";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { LanguageSelect } from "../../ui/LanguageSelect";
import { SettingsPage } from "../../ui/Page";
import { Button } from "../../ui/kit/Button";
import { SettingsGroup, SettingsRow } from "../../ui/kit/Settings";
import { USER_ROLE_LABELS } from "../../ui/user-roles";

export const Route = createFileRoute("/_workbench/account")({
  staticData: { crumbs: () => [{ label: m.account_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.account_title()) }],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user } = Route.useRouteContext();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <SettingsPage title={m.account_title()}>
      <SettingsGroup title={m.account_profile()}>
        <SettingsRow label={m.account_name()}>{user.name}</SettingsRow>
        <SettingsRow label={m.account_email()}>{user.email}</SettingsRow>
        <SettingsRow label={m.role_label()}>
          {USER_ROLE_LABELS[user.role]()}
        </SettingsRow>
        <SettingsRow label={m.account_password()}>
          <Button onClick={() => setChangingPassword(true)}>
            {m.account_change_password()}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title={m.account_preferences()}>
        <SettingsRow label={m.account_language()}>
          <div className="w-40">
            <LanguageSelect aria-label={m.account_language()} />
          </div>
        </SettingsRow>
      </SettingsGroup>
      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
      />
    </SettingsPage>
  );
}
