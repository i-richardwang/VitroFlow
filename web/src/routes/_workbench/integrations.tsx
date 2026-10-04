import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { ApiKeysTable } from "../../features/integrations/ApiKeysTable";
import { MCP_SERVER_LABELS } from "../../features/integrations/labels";
import { McpClientsTable } from "../../features/integrations/McpClientsTable";
import { NewApiKeyDialog } from "../../features/integrations/NewApiKeyDialog";
import { MCP_SERVERS } from "../../domain/auth/integrations";
import { getIntegrations } from "../../functions/integrations";
import { m } from "../../paraglide/messages";
import { CopyableCode, CopyableCodeSkeleton } from "../../ui/CopyableCode";
import { Page, PageSection, PageSectionSkeleton } from "../../ui/Page";
import { Button } from "../../ui/kit/Button";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";

export const Route = createFileRoute("/_workbench/integrations")({
  loader: () => getIntegrations(),
  staticData: { crumbs: () => [{ label: m.integrations_title() }] },
  head: () => ({
    meta: [{ title: `${m.integrations_title()} · ${m.app_name()}` }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton action />
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <div className="grid gap-4 md:grid-cols-2">
          {MCP_SERVERS.map((server) => (
            <CopyableCodeSkeleton
              key={server}
              label={MCP_SERVER_LABELS[server]()}
            />
          ))}
        </div>
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={2} />
      </PageSectionSkeleton>
    </PageSkeleton>
  ),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { apiKeys, mcpClients, mcpUrls } = Route.useLoaderData();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={m.integrations_title()}
      actions={
        <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
          {m.integrations_new_key()}
        </Button>
      }
    >
      <PageSection title={m.integrations_api_keys()}>
        <ApiKeysTable apiKeys={apiKeys} onCreate={() => setCreating(true)} />
      </PageSection>
      <PageSection title={m.integrations_mcp_servers()}>
        <div className="grid gap-4 md:grid-cols-2">
          {MCP_SERVERS.map((server) => (
            <CopyableCode
              key={server}
              value={mcpUrls[server]}
              label={MCP_SERVER_LABELS[server]()}
            />
          ))}
        </div>
      </PageSection>
      <PageSection title={m.integrations_mcp_clients()}>
        <McpClientsTable mcpClients={mcpClients} />
      </PageSection>
      <NewApiKeyDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
