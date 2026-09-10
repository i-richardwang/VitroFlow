import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { McpClient } from "../../domain/auth/integrations";
import { removeMcpClient } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { DestructiveActionButton } from "../../ui/DestructiveActionDialog";
import { Timestamp } from "../../ui/Timestamp";

export function McpClientsTable({ mcpClients }: { mcpClients: McpClient[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={m.integrations_mcp_clients()}>
          <Table.Header>
            <Table.Column isRowHeader>{m.mcp_column_client()}</Table.Column>
            <Table.Column>{m.mcp_column_approved()}</Table.Column>
            <Table.Column aria-label={m.mcp_column_actions()} />
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>{m.mcp_empty()}</EmptyState.Title>
                </EmptyState.Header>
              </EmptyState>
            )}
          >
            {mcpClients.map((client) => (
              <Table.Row key={client.id}>
                <Table.Cell className="font-medium">{client.name}</Table.Cell>
                <Table.Cell className="text-muted">
                  <Timestamp value={client.lastGrantedAt} />
                </Table.Cell>
                <Table.Cell className="text-right">
                  <DisconnectMcpClientButton client={client} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function DisconnectMcpClientButton({ client }: { client: McpClient }) {
  const router = useRouter();

  return (
    <DestructiveActionButton
      label={m.mcp_disconnect()}
      title={m.mcp_disconnect_title({ name: client.name })}
      confirmLabel={m.mcp_disconnect()}
      onConfirm={async () => {
        await removeMcpClient({ data: { client: client.id } });
        toast.success(m.mcp_disconnected({ name: client.name }));
        await router.invalidate();
      }}
    />
  );
}
