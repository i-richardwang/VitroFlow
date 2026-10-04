import { useRouter } from "@tanstack/react-router";
import { Plug, Unplug } from "lucide-react";

import { MCP_SERVER_LABELS } from "./labels";
import type { McpClient } from "../../domain/auth/integrations";
import { removeMcpClient } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { Timestamp } from "../../ui/Timestamp";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { ActionIcon } from "../../ui/kit/ActionIcon";
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
import { Text } from "../../ui/kit/Text";
import { toast } from "../../ui/kit/Toast";

export function McpClientsTable({ mcpClients }: { mcpClients: McpClient[] }) {
  return (
    <Table narrow="cards" aria-label={m.integrations_mcp_clients()}>
      <TableHeader>
        <tr>
          <TableHead>{m.mcp_column_client()}</TableHead>
          <TableHead>{m.mcp_column_servers()}</TableHead>
          <TableHead>{m.mcp_column_approved()}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{m.mcp_column_actions()}</span>
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {mcpClients.length ? (
          mcpClients.map((client) => (
            <McpClientRow key={client.id} client={client} />
          ))
        ) : (
          <TableEmpty>
            <Empty
              icon={Plug}
              title={m.mcp_empty()}
              description={m.mcp_empty_description()}
            />
          </TableEmpty>
        )}
      </TableBody>
    </Table>
  );
}

function McpClientRow({ client }: { client: McpClient }) {
  const router = useRouter();

  return (
    <TableRow>
      <TableCell cellSlot="title">{client.name}</TableCell>
      <TableCell cellLabel={m.mcp_column_servers()}>
        <Flexbox horizontal gap={4} wrap="wrap">
          {client.servers.map((server) => (
            <Tag key={server} size="small">
              {MCP_SERVER_LABELS[server]()}
            </Tag>
          ))}
        </Flexbox>
      </TableCell>
      <TableCell cellLabel={m.mcp_column_approved()}>
        <Text as="span" type="secondary">
          <Timestamp value={client.lastGrantedAt} />
        </Text>
      </TableCell>
      <TableCell cellSlot="extra" className="text-end">
        <ActionIcon
          icon={Unplug}
          size="small"
          title={m.mcp_disconnect()}
          onClick={() =>
            confirmDestructive({
              title: m.mcp_disconnect_title({ name: client.name }),
              confirmLabel: m.mcp_disconnect(),
              onConfirm: async () => {
                await removeMcpClient({ data: { client: client.id } });
                toast.success(m.mcp_disconnected({ name: client.name }));
                await router.invalidate();
              },
            })
          }
        />
      </TableCell>
    </TableRow>
  );
}
