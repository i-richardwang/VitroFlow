import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import { API_SCOPE_LABELS, type ApiKey } from "../../auth/integrations";
import { removeApiKey } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { DestructiveActionButton } from "../DestructiveActionDialog";
import { Timestamp } from "../Timestamp";

export function ApiKeysTable({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={m.integrations_api_keys()}>
          <Table.Header>
            <Table.Column isRowHeader>{m.api_key_column_name()}</Table.Column>
            <Table.Column>{m.api_key_column_key()}</Table.Column>
            <Table.Column>{m.api_key_column_scopes()}</Table.Column>
            <Table.Column>{m.api_key_column_expires()}</Table.Column>
            <Table.Column>{m.api_key_column_last_used()}</Table.Column>
            <Table.Column aria-label={m.api_key_column_actions()} />
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>{m.api_key_empty()}</EmptyState.Title>
                </EmptyState.Header>
              </EmptyState>
            )}
          >
            {apiKeys.map((apiKey) => (
              <Table.Row key={apiKey.id}>
                <Table.Cell className="font-medium">{apiKey.name}</Table.Cell>
                <Table.Cell className="font-mono text-muted">
                  {apiKey.start}…
                </Table.Cell>
                <Table.Cell className="text-muted">
                  {apiKey.scopes
                    .map((scope) => API_SCOPE_LABELS[scope]())
                    .join(" · ")}
                </Table.Cell>
                <Table.Cell className="text-muted">
                  {apiKey.expiresAt ? (
                    <Timestamp value={apiKey.expiresAt} />
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell className="text-muted">
                  {apiKey.lastUsedAt ? (
                    <Timestamp value={apiKey.lastUsedAt} />
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RevokeApiKeyButton apiKey={apiKey} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function RevokeApiKeyButton({ apiKey }: { apiKey: ApiKey }) {
  const router = useRouter();

  return (
    <DestructiveActionButton
      label={m.api_key_revoke()}
      title={m.api_key_revoke_title({ name: apiKey.name })}
      confirmLabel={m.api_key_revoke()}
      onConfirm={async () => {
        await removeApiKey({ data: { key: apiKey.id } });
        toast.success(m.api_key_revoked({ name: apiKey.name }));
        await router.invalidate();
      }}
    />
  );
}
