import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { NewUserDialog } from "../../features/users/NewUserDialog";
import { RoleSelect } from "../../features/users/RoleSelect";
import { UserMenu } from "../../features/users/UserMenu";
import { isAdmin, type UserAccount } from "../../domain/auth/schema";
import { changeUserRole, getUsers } from "../../functions/users";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Button } from "../../ui/kit/Button";
import { Flexbox } from "../../ui/kit/Flex";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import { SettingsGroup, SettingsGroupSkeleton } from "../../ui/kit/Settings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";

export const Route = createFileRoute("/_workbench/users")({
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.user)) throw notFound();
  },
  loader: () => getUsers(),
  staticData: { crumbs: () => [{ label: m.users_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.users_title()) }],
  }),
  pendingComponent: () => (
    <SettingsPageSkeleton>
      <SettingsGroupSkeleton>
        <TableSkeleton rows={3} />
      </SettingsGroupSkeleton>
    </SettingsPageSkeleton>
  ),
  component: UsersPage,
});

function UsersPage() {
  const accounts = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const [creating, setCreating] = useState(false);

  return (
    <SettingsPage title={m.users_title()}>
      <SettingsGroup
        title={m.users_title()}
        extra={
          <>
            {m.users_count({ count: accounts.length })}
            <Button
              size="small"
              type="primary"
              icon={Plus}
              onClick={() => setCreating(true)}
            >
              {m.users_new()}
            </Button>
          </>
        }
      >
        <Table narrow="cards" aria-label={m.users_title()}>
          <TableHeader>
            <tr>
              <TableHead>{m.users_column_name()}</TableHead>
              <TableHead>{m.users_column_email()}</TableHead>
              <TableHead className="w-40">{m.users_column_role()}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{m.users_column_actions()}</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <UserRow
                key={account.id}
                account={account}
                self={account.id === me.id}
              />
            ))}
          </TableBody>
        </Table>
      </SettingsGroup>
      <NewUserDialog open={creating} onClose={() => setCreating(false)} />
    </SettingsPage>
  );
}

function UserRow({ account, self }: { account: UserAccount; self: boolean }) {
  const router = useRouter();
  const { busy, run } = useAsyncAction();

  return (
    <TableRow>
      <TableCell cellSlot="title">
        <Flexbox horizontal align="center" gap={8}>
          {account.name}
          {self ? <Tag size="small">{m.users_you()}</Tag> : null}
          {account.banned ? (
            <Tag size="small" color="warning">
              {m.user_status_suspended()}
            </Tag>
          ) : null}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.users_column_email()}>
        <span className="text-fg-secondary">{account.email}</span>
      </TableCell>
      <TableCell cellLabel={m.users_column_role()}>
        <RoleSelect
          aria-label={m.user_role_of({ name: account.name })}
          value={account.role}
          size="small"
          variant="borderless"
          disabled={self || busy}
          onChange={(role) => {
            if (role === account.role) return;
            void run(
              () => changeUserRole({ data: { user: account.id, role } }),
              m.user_role_not_changed(),
            ).then(async (result) => {
              if (result.ok) await router.invalidate();
            });
          }}
        />
      </TableCell>
      <TableCell cellSlot="actions" className="text-end">
        {self ? null : <UserMenu account={account} />}
      </TableCell>
    </TableRow>
  );
}
