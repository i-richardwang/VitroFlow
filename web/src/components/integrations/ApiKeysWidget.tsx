import { EmptyState } from "@heroui-pro/react/empty-state";
import { Widget } from "@heroui-pro/react/widget";
import { Button, Chip, Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { API_SCOPE_LABELS, type ApiKey } from "../../auth/integrations";
import { removeApiKey } from "../../functions/integrations";
import { DeleteDialog } from "../DeleteDialog";
import { Timestamp } from "../Timestamp";
import { NewApiKeyDialog } from "./NewApiKeyDialog";

export function ApiKeysWidget({ apiKeys }: { apiKeys: ApiKey[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  return (
    <Widget>
      <Widget.Header className="flex items-start justify-between gap-4">
        <div>
          <Widget.Title>API keys</Widget.Title>
          <Widget.Description>
            Bearer credentials for the HTTP surfaces. A key acts as you within
            its scopes and stops working the moment it is revoked.
          </Widget.Description>
        </div>
        <Button variant="primary" size="sm" onPress={() => setCreating(true)}>
          New key
        </Button>
      </Widget.Header>
      <Widget.Content className="p-0">
        <Table variant="secondary">
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
                      <EmptyState.Description>
                        Create one to let an agent or dataset export client act
                        as you.
                      </EmptyState.Description>
                    </EmptyState.Header>
                  </EmptyState>
                )}
              >
                {apiKeys.map((apiKey, idx) => (
                  <Table.Row
                    key={apiKey.id}
                    className={
                      idx === apiKeys.length - 1 ? "[&_td]:border-b-0" : ""
                    }
                  >
                    <Table.Cell className="text-sm font-medium">
                      {apiKey.name}
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm text-muted">
                      {apiKey.start}…
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-1">
                        {apiKey.scopes.map((scope) => (
                          <Chip
                            key={scope}
                            color="accent"
                            variant="soft"
                            size="sm"
                          >
                            {API_SCOPE_LABELS[scope].label}
                          </Chip>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-sm text-muted">
                      {apiKey.expiresAt ? (
                        <Timestamp value={apiKey.expiresAt} />
                      ) : (
                        "Never"
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-sm text-muted">
                      {apiKey.lastUsedAt ? (
                        <Timestamp value={apiKey.lastUsedAt} />
                      ) : (
                        "Not yet"
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <Button
                        variant="danger-soft"
                        size="sm"
                        onPress={() => setRevoking(apiKey)}
                      >
                        Revoke
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Widget.Content>
      <NewApiKeyDialog isOpen={creating} onClose={() => setCreating(false)} />
      <DeleteDialog
        isOpen={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke API key"
        confirmLabel="Revoke"
        onConfirm={async () => {
          if (!revoking) return;
          await removeApiKey({ data: { key: revoking.id } });
          toast.success(`${revoking.name} revoked`);
          await router.invalidate();
        }}
      >
        Requests presenting {revoking?.name} are refused from now on. This
        cannot be undone.
      </DeleteDialog>
    </Widget>
  );
}
