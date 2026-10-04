import { useRouter } from "@tanstack/react-router";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import { API_SCOPE_LABELS } from "./labels";
import type { ApiKey } from "../../domain/auth/integrations";
import { removeApiKey } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { Timestamp } from "../../ui/Timestamp";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Flexbox } from "../../ui/kit/Flex";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";
import { toast } from "../../ui/kit/Toast";

export function ApiKeysTable({
  apiKeys,
  onCreate,
}: {
  apiKeys: ApiKey[];
  /** Opens the new key dialog. */
  onCreate: () => void;
}) {
  return (
    <Table narrow="cards" aria-label={m.integrations_api_keys()}>
      <TableHeader>
        <tr>
          <TableHead>{m.api_key_column_name()}</TableHead>
          <TableHead>{m.api_key_column_key()}</TableHead>
          <TableHead>{m.api_key_column_scopes()}</TableHead>
          <TableHead>{m.api_key_column_expires()}</TableHead>
          <TableHead>{m.api_key_column_last_used()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.api_key_column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {apiKeys.length ? (
          apiKeys.map((apiKey) => <ApiKeyRow key={apiKey.id} apiKey={apiKey} />)
        ) : (
          <TableEmpty>
            <Empty
              icon={KeyRound}
              title={m.api_key_empty()}
              description={m.api_key_empty_description()}
              action={
                <Button icon={Plus} onClick={onCreate}>
                  {m.integrations_new_key()}
                </Button>
              }
            />
          </TableEmpty>
        )}
      </TableBody>
    </Table>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const router = useRouter();
  const expired =
    apiKey.expiresAt !== null && new Date(apiKey.expiresAt) <= new Date();

  return (
    <TableRow>
      <TableCell cellSlot="title">{apiKey.name}</TableCell>
      <TableCell cellLabel={m.api_key_column_key()}>
        <span className="font-mono text-xs text-fg-secondary">
          {m.api_key_start({ start: apiKey.start })}
        </span>
      </TableCell>
      <TableCell cellLabel={m.api_key_column_scopes()}>
        <Flexbox horizontal gap={4} wrap="wrap">
          {apiKey.scopes.map((scope) => (
            <Tag key={scope} size="small">
              {API_SCOPE_LABELS[scope]()}
            </Tag>
          ))}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.api_key_column_expires()}>
        {apiKey.expiresAt === null ? (
          <span className="text-fg-secondary">{m.api_key_expiry_never()}</span>
        ) : expired ? (
          <span className="text-error">{m.api_key_expired()}</span>
        ) : (
          <span className="text-fg-secondary">
            <Timestamp value={apiKey.expiresAt} />
          </span>
        )}
      </TableCell>
      <TableCell cellLabel={m.api_key_column_last_used()}>
        <span className="text-fg-secondary">
          {apiKey.lastUsedAt === null ? (
            m.api_key_never_used()
          ) : (
            <Timestamp value={apiKey.lastUsedAt} />
          )}
        </span>
      </TableCell>
      <TableCell cellSlot="extra" className="text-end">
        <ActionIcon
          icon={Trash2}
          size="small"
          title={m.api_key_revoke()}
          onClick={() =>
            confirmDestructive({
              title: m.api_key_revoke_title({ name: apiKey.name }),
              confirmLabel: m.api_key_revoke(),
              onConfirm: async () => {
                await removeApiKey({ data: { key: apiKey.id } });
                toast.success(m.api_key_revoked({ name: apiKey.name }));
                await router.invalidate();
              },
            })
          }
        />
      </TableCell>
    </TableRow>
  );
}
