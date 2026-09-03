import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, Chip, Table } from "@heroui/react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";

import { USER_ROLE_LABELS, isAdmin, type UserAccount } from "../../auth/schema";
import { Page } from "../../components/Page";
import { NewUserDialog } from "../../components/users/NewUserDialog";
import { UserMenu } from "../../components/users/UserMenu";
import { getUsers } from "../../functions/users";

export const Route = createFileRoute("/_workbench/users")({
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.user)) throw notFound();
  },
  loader: () => getUsers(),
  staticData: { crumbs: [{ label: "Users" }] },
  head: () => ({ meta: [{ title: "Users · VitroFlow" }] }),
  component: UsersPage,
});

function UsersPage() {
  const accounts = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title="Users"
      actions={
        <Button variant="primary" onPress={() => setCreating(true)}>
          New user
        </Button>
      }
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Users">
            <Table.Header>
              <Table.Column isRowHeader>Name</Table.Column>
              <Table.Column>Email</Table.Column>
              <Table.Column>Role</Table.Column>
              <Table.Column>Status</Table.Column>
              <Table.Column aria-label="Actions" />
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>No accounts</EmptyState.Title>
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
                      {USER_ROLE_LABELS[account.role]}
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
      Suspended
    </Chip>
  ) : (
    <Chip color="success" variant="soft" size="sm">
      Active
    </Chip>
  );
}
