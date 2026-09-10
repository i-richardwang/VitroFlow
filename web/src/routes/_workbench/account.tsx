import { ChangePasswordForm } from "../../features/account/ChangePasswordForm";

import { createFileRoute } from "@tanstack/react-router";

import { LanguageSelect } from "../../ui/LanguageSelect";
import { Page, PageSection } from "../../ui/Page";

import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/account")({
  staticData: { crumbs: () => [{ label: m.account_title() }] },
  head: () => ({
    meta: [{ title: `${m.account_title()} · ${m.app_name()}` }],
  }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <Page title={m.account_title()}>
      <div className="max-w-md">
        <LanguageSelect />
      </div>
      <PageSection title={m.account_change_password()}>
        <ChangePasswordForm />
      </PageSection>
    </Page>
  );
}
