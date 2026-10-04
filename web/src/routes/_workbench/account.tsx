import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ChangePasswordDialog } from "../../features/account/ChangePasswordDialog";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { LanguageSelect } from "../../ui/LanguageSelect";
import { Page, PageSection } from "../../ui/Page";
import { Button } from "../../ui/kit/Button";
import { Card } from "../../ui/kit/Card";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
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
    <Page title={m.account_title()}>
      <PageSection title={m.account_profile()}>
        <Card>
          <Descriptions aligned>
            <DescriptionsItem label={m.account_name()}>
              {user.name}
            </DescriptionsItem>
            <DescriptionsItem label={m.account_email()}>
              {user.email}
            </DescriptionsItem>
            <DescriptionsItem label={m.role_label()}>
              {USER_ROLE_LABELS[user.role]()}
            </DescriptionsItem>
            <DescriptionsItem label={m.account_password()}>
              <Button size="small" onClick={() => setChangingPassword(true)}>
                {m.account_change_password()}
              </Button>
            </DescriptionsItem>
          </Descriptions>
        </Card>
      </PageSection>
      <PageSection title={m.account_preferences()}>
        <Card>
          <Descriptions aligned>
            <DescriptionsItem label={m.account_language()}>
              <div className="max-w-60">
                <LanguageSelect aria-label={m.account_language()} />
              </div>
            </DescriptionsItem>
          </Descriptions>
        </Card>
      </PageSection>
      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
      />
    </Page>
  );
}
