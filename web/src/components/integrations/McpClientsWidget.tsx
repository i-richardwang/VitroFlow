import { EmptyState } from "@heroui-pro/react/empty-state";
import { Widget } from "@heroui-pro/react/widget";
import { Button, Table, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { McpClient } from "../../auth/integrations";
import { removeMcpClient } from "../../functions/integrations";
import { DeleteDialog } from "../DeleteDialog";
import { Timestamp } from "../Timestamp";
import { CopyableCode } from "./CopyableCode";

export function McpClientsWidget({
  mcpClients,
  mcpUrl,
}: {
  mcpClients: McpClient[];
  mcpUrl: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<McpClient | null>(null);

  return (
    <Widget>
      <Widget.Header>
        <Widget.Title>MCP clients</Widget.Title>
        <Widget.Description>
          Clients you have authorized to use the MCP tools as you. Point a
          client at the endpoint and approve it when it asks.
        </Widget.Description>
      </Widget.Header>
      <Widget.Content className="flex flex-col gap-4">
        <CopyableCode value={mcpUrl} label="MCP endpoint" />
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="MCP clients">
              <Table.Header>
                <Table.Column isRowHeader>Client</Table.Column>
                <Table.Column>Approved</Table.Column>
                <Table.Column>Last approved</Table.Column>
                <Table.Column aria-label="Actions" />
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <EmptyState size="sm">
                    <EmptyState.Header>
                      <EmptyState.Title>No MCP clients</EmptyState.Title>
                      <EmptyState.Description>
                        A client appears here once you approve its authorization
                        request.
                      </EmptyState.Description>
                    </EmptyState.Header>
                  </EmptyState>
                )}
              >
                {mcpClients.map((client, idx) => (
                  <Table.Row
                    key={client.id}
                    className={
                      idx === mcpClients.length - 1 ? "[&_td]:border-b-0" : ""
                    }
                  >
                    <Table.Cell className="text-sm font-medium">
                      {client.name}
                    </Table.Cell>
                    <Table.Cell className="text-sm text-muted">
                      <Timestamp value={client.grantedAt} />
                    </Table.Cell>
                    <Table.Cell className="text-sm text-muted">
                      <Timestamp value={client.lastGrantedAt} />
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <Button
                        variant="danger-soft"
                        size="sm"
                        onPress={() => setDisconnecting(client)}
                      >
                        Disconnect
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Widget.Content>
      <DeleteDialog
        isOpen={disconnecting !== null}
        onOpenChange={(open) => !open && setDisconnecting(null)}
        title="Disconnect MCP client"
        confirmLabel="Disconnect"
        onConfirm={async () => {
          if (!disconnecting) return;
          await removeMcpClient({ data: { client: disconnecting.id } });
          toast.success(`${disconnecting.name} disconnected`);
          await router.invalidate();
        }}
      >
        {disconnecting?.name} loses access immediately and must be approved
        again to continue.
      </DeleteDialog>
    </Widget>
  );
}
