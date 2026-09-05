import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, Chip, Table } from "@heroui/react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";

import { USER_ROLE_LABELS, isAdmin, type UserAccount } from "../../auth/schema";
import { Page } from "../../components/Page";
import { NewUserDialog } from "../../components/users/NewUserDialog";
import { UserMenu } from "../../components/users/UserMenu";
import { getUsers } from "../../functions/users";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/users")({
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.user)) throw notFound();
  },
  loader: () => getUsers(),
  staticData: { crumbs: () => [{ label: m.users_title() }] },
  head: () => ({
    meta: [{ title: `${m.users_title()} · ${m.app_name()}` }],
  }),
  component: UsersPage,
});

function UsersPage() {
  const accounts = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={m.users_title()}
      actions={
        <Button variant="primary" onPress={() => setCreating(true)}>
          {m.users_new()}
        </Button>
      }
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.users_title()}>
            <Table.Header>
              <Table.Column isRowHeader>{m.users_column_name()}</Table.Column>
              <Table.Column>{m.users_column_email()}</Table.Column>
              <Table.Column>{m.users_column_role()}</Table.Column>
              <Table.Column>{m.users_column_status()}</Table.Column>
              <Table.Column aria-label={m.users_column_actions()} />
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>{m.users_empty()}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {accounts.map((account) => (
                <Table.Row key={account.id}>
                  <Table.Cell className="font-medium">
                    {account.name}
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted">
                    {account.email}
                  </Table.Cell>
                  <Table.Cell>
                    <Chip
                      color={account.role === "admin" ? "accent" : "default"}
                      variant="soft"
                      size="sm"
                    >
                      {USER_ROLE_LABELS[account.role]()}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusChip account={account} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {account.id === me.id ? null : (
                      <UserMenu account={account} />
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <NewUserDialog isOpen={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function StatusChip({ account }: { account: UserAccount }) {
  return account.banned ? (
    <Chip color="warning" variant="soft" size="sm">
      {m.user_status_suspended()}
    </Chip>
  ) : (
    <Chip color="success" variant="soft" size="sm">
      {m.user_status_active()}
    </Chip>
  );
}
