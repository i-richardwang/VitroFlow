import { EmptyState } from "@heroui-pro/react/empty-state";
import { Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { McpClient } from "../../auth/integrations";
import { removeMcpClient } from "../../functions/integrations";
import { DestructiveActionButton } from "../DestructiveActionDialog";
import { Timestamp } from "../Timestamp";

export function McpClientsTable({ mcpClients }: { mcpClients: McpClient[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="MCP clients">
          <Table.Header>
            <Table.Column isRowHeader>Client</Table.Column>
            <Table.Column>Approved</Table.Column>
            <Table.Column aria-label="Actions" />
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>No MCP clients</EmptyState.Title>
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
      label="Disconnect"
      title={`Disconnect ${client.name}?`}
      confirmLabel="Disconnect"
      onConfirm={async () => {
        await removeMcpClient({ data: { client: client.id } });
        toast.success(`${client.name} disconnected`);
        await router.invalidate();
      }}
    />
  );
}
