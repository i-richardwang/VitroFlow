import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import { API_SCOPE_LABELS, type ApiKey } from "../../auth/integrations";
import { removeApiKey } from "../../functions/integrations";
import { DestructiveActionButton } from "../DestructiveActionDialog";
import { Timestamp } from "../Timestamp";

export function ApiKeysTable({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="API keys">
          <Table.Header>
            <Table.Column isRowHeader>Name</Table.Column>
            <Table.Column>Key</Table.Column>
            <Table.Column>Scopes</Table.Column>
            <Table.Column>Expires</Table.Column>
            <Table.Column>Last used</Table.Column>
            <Table.Column aria-label="Actions" />
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>No API keys</EmptyState.Title>
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
                    .map((scope) => API_SCOPE_LABELS[scope])
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
      label="Revoke"
      title={`Revoke ${apiKey.name}?`}
      confirmLabel="Revoke"
      onConfirm={async () => {
        await removeApiKey({ data: { key: apiKey.id } });
        toast.success(`${apiKey.name} revoked`);
        await router.invalidate();
      }}
    />
  );
}
